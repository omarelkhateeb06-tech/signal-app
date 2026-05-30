// Phase 12n.x — Hacker News community-synthesis native generator.
//
// AUTHORS one native post per qualifying sector about what the community's
// week of high-engagement NON-REPO discussion reveals. Sibling to the
// HN-repo generator, but the subject is the COMMUNITY's attention, not a
// single artifact: the post reads the week's engagement pattern (broad
// interest vs. active debate) for what it signals to a practitioner.
//
//   DISCOVER  published, sector-tagged HN candidates from the last 7 days
//             whose URL is NOT a github.com repo, at or above a score floor.
//             Published is the only sector-tagged pool — the llm_rejected /
//             heuristic_filtered HN pools never reach the sector seam, so
//             their sector is null and they can't be grouped.
//   QUALIFY   per sector: ≥3 qualifying threads. Dedup by external_id
//             `hn-synthesis:{sector}:{ISO-week}` for weekly cadence.
//   AUTHOR    hand the top 3-5 threads (title + score + comments + the
//             distilled SIGNAL take when the thread became an event) to
//             Haiku, which names the attention pattern. One Haiku call per
//             sector; the 3-tier enrichment seam runs on the authored body.
//
// Sector scope: all three (AI / Finance / Semis) — whichever had the
// discussion volume qualifies. Cap 2 posts/run.
//
// Slug `hn-synthesis-native` — seeded by migration 0038. The CLI dry-run
// tolerates a missing row; a real run requires it.

import {
  buildHnSynthesisPrompt,
  HN_SYNTHESIS_ASSISTANT_PREFILL,
  HN_SYNTHESIS_MAX_TOKENS,
  type HnSynthesisInputs,
  type HnThreadInput,
} from "../../../llm/prompts/ingestion/hnSynthesisPrompt";
import { callHaikuForCommentary, type HaikuClientDeps } from "../../../services/haikuCommentaryClient";
import { parseTierTemplate } from "../../../utils/depthVariants";
import { VALID_SECTORS, type Sector } from "../relevanceSeam";
import { isoWeekOf, weekLabelOf } from "./isoWeek";
import type { NativeCandidate, NativeGenerator, NativeGeneratorContext } from "./types";
import { z } from "zod";

// ---- Config ----

export const HN_SYNTHESIS_SLUG = "hn-synthesis-native";

export const MAX_SYNTHESIS_POSTS_PER_RUN = 2;
export const SYNTHESIS_WINDOW_DAYS = 7;

// A community-attention read needs at least three threads to be a pattern
// rather than a single hot link.
export const MIN_THREADS_PER_SECTOR = 3;

// Cap on threads fed to the prompt — the top by score are the strongest
// signal of where attention concentrated.
export const MAX_THREADS_IN_CONTEXT = 5;

// HN score floor. HN ingestion already filters near this; the floor here is
// the configurable knob the spec calls for, so the synthesis weights only
// genuinely high-engagement threads.
export const MIN_HN_SCORE = 100;

// Whichever sector had the volume qualifies. Order is the run priority.
export const SYNTHESIS_SECTORS: readonly Sector[] = VALID_SECTORS;

export const DEDUP_WINDOW_DAYS = SYNTHESIS_WINDOW_DAYS + 1;

// ---- Model output contract ----

const HnSynthesisOutputSchema = z
  .object({
    headline: z.string().min(8).max(200),
    body: z.string().min(200).max(2400),
  })
  .strict();

export type HnSynthesisOutput = z.infer<typeof HnSynthesisOutputSchema>;

export type AuthorOutcome =
  | { status: "authored"; output: HnSynthesisOutput }
  | { status: "skipped"; reason: string }
  | { status: "error"; reason: string };

// ---- Discovery shapes ----

// One published HN non-repo candidate, as the discover dep returns it.
export interface HnThreadRow {
  sector: string;
  title: string;
  score: number;
  comments: number;
  template: string | null; // resolved event's why_it_matters_template, if any
  genericCommentary: string | null;
  url: string;
}

// ---- Pure helpers (exported for tests) ----

// The distilled SIGNAL take for a thread that became an event, or null.
export function commentaryOf(row: HnThreadRow): string | null {
  const tmpl = parseTierTemplate(row.template);
  if (tmpl) return tmpl.accessible.thesis;
  if (row.genericCommentary && row.genericCommentary.trim().length > 0) {
    return row.genericCommentary.trim();
  }
  return null;
}

function isSector(value: string): value is Sector {
  return (VALID_SECTORS as readonly string[]).includes(value);
}

// Group qualifying threads by sector, highest score first. Rows below the
// score floor or in no scoped sector are dropped.
export function groupBySector(
  rows: HnThreadRow[],
  minScore: number = MIN_HN_SCORE,
): Map<Sector, HnThreadRow[]> {
  const grouped = new Map<Sector, HnThreadRow[]>();
  for (const row of rows) {
    if (row.score < minScore) continue;
    if (!isSector(row.sector)) continue;
    if (!SYNTHESIS_SECTORS.includes(row.sector)) continue;
    const list = grouped.get(row.sector) ?? [];
    list.push(row);
    grouped.set(row.sector, list);
  }
  for (const list of grouped.values()) list.sort((a, b) => b.score - a.score);
  return grouped;
}

export function hnSynthesisExternalId(sector: Sector, isoWeek: string): string {
  return `hn-synthesis:${sector}:${isoWeek}`;
}

// ---- Generator deps (injectable for tests) ----

export interface HnCommunitySynthesisDeps {
  discover?: (now: Date) => Promise<HnThreadRow[]>;
  existingExternalIds?: (now: Date) => Promise<Set<string>>;
  haiku?: HaikuClientDeps;
  authorPost?: (
    inputs: HnSynthesisInputs,
    haiku?: HaikuClientDeps,
  ) => Promise<AuthorOutcome>;
}

// Published, sector-tagged, non-github HN candidates in the window. LEFT
// JOINs the resolved event to lift its distilled take when the thread became
// a story. Fail-CLOSED: any DB error returns [].
async function defaultDiscover(now: Date): Promise<HnThreadRow[]> {
  try {
    const [{ db }, schema, drizzle] = await Promise.all([
      import("../../../db"),
      import("../../../db/schema"),
      import("drizzle-orm"),
    ]);
    const { ingestionCandidates, ingestionSources, events } = schema;
    const { and, eq, gt, sql } = drizzle;
    const since = new Date(now.getTime() - SYNTHESIS_WINDOW_DAYS * 24 * 3600 * 1000);
    const rows = await db
      .select({
        sector: ingestionCandidates.sector,
        title: ingestionCandidates.rawTitle,
        score: sql<string | null>`${ingestionCandidates.rawPayload}->>'score'`,
        comments: sql<string | null>`${ingestionCandidates.rawPayload}->>'descendants'`,
        template: events.whyItMattersTemplate,
        genericCommentary: events.genericCommentary,
        url: ingestionCandidates.url,
      })
      .from(ingestionCandidates)
      .innerJoin(
        ingestionSources,
        eq(ingestionCandidates.ingestionSourceId, ingestionSources.id),
      )
      .leftJoin(events, eq(ingestionCandidates.resolvedEventId, events.id))
      .where(
        and(
          eq(ingestionSources.adapterType, "hackernews_api"),
          eq(ingestionCandidates.status, "published"),
          sql`${ingestionCandidates.url} NOT ILIKE '%github.com%'`,
          gt(ingestionCandidates.discoveredAt, since),
        ),
      );
    return rows
      .filter((r): r is typeof r & { sector: string; title: string } =>
        Boolean(r.sector) && Boolean(r.title),
      )
      .map((r) => ({
        sector: r.sector,
        title: r.title,
        score: r.score ? parseInt(r.score, 10) || 0 : 0,
        comments: r.comments ? parseInt(r.comments, 10) || 0 : 0,
        template: r.template,
        genericCommentary: r.genericCommentary,
        url: r.url,
      }));
  } catch {
    return [];
  }
}

async function defaultExistingExternalIds(now: Date): Promise<Set<string>> {
  try {
    const [{ db }, schema, drizzle] = await Promise.all([
      import("../../../db"),
      import("../../../db/schema"),
      import("drizzle-orm"),
    ]);
    const { ingestionCandidates, ingestionSources } = schema;
    const { and, eq, gt } = drizzle;
    const since = new Date(now.getTime() - DEDUP_WINDOW_DAYS * 24 * 3600 * 1000);
    const rows = await db
      .select({ externalId: ingestionCandidates.externalId })
      .from(ingestionCandidates)
      .innerJoin(
        ingestionSources,
        eq(ingestionCandidates.ingestionSourceId, ingestionSources.id),
      )
      .where(
        and(
          eq(ingestionSources.slug, HN_SYNTHESIS_SLUG),
          gt(ingestionCandidates.discoveredAt, since),
        ),
      );
    return new Set(rows.map((r) => r.externalId));
  } catch {
    return new Set();
  }
}

async function defaultAuthorPost(
  inputs: HnSynthesisInputs,
  haiku?: HaikuClientDeps,
): Promise<AuthorOutcome> {
  const prompt = buildHnSynthesisPrompt(inputs);
  const result = await callHaikuForCommentary(prompt, haiku, {
    assistantPrefill: HN_SYNTHESIS_ASSISTANT_PREFILL,
    maxTokens: HN_SYNTHESIS_MAX_TOKENS,
  });
  if (!result.ok) return { status: "error", reason: "llm_call_failed" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.text);
  } catch {
    return { status: "error", reason: "parse_error" };
  }
  if (
    parsed !== null &&
    typeof parsed === "object" &&
    (parsed as { skip?: unknown }).skip === true
  ) {
    const rawReason = (parsed as { reason?: unknown }).reason;
    const reason =
      typeof rawReason === "string" && rawReason.trim().length > 0
        ? rawReason.trim()
        : "unspecified";
    return { status: "skipped", reason };
  }
  const validated = HnSynthesisOutputSchema.safeParse(parsed);
  return validated.success
    ? { status: "authored", output: validated.data }
    : { status: "error", reason: "schema_invalid" };
}

export function createHnCommunitySynthesisGenerator(
  deps: HnCommunitySynthesisDeps = {},
): NativeGenerator {
  const discover = deps.discover ?? defaultDiscover;
  const existingExternalIds =
    deps.existingExternalIds ?? defaultExistingExternalIds;
  const authorPost = deps.authorPost ?? defaultAuthorPost;

  return {
    slug: HN_SYNTHESIS_SLUG,
    async generate(ctx: NativeGeneratorContext): Promise<NativeCandidate[]> {
      const now = ctx.now();
      const emit = ctx.onDiagnostic;
      const isoWeek = isoWeekOf(now);
      const weekLabel = weekLabelOf(now);

      const rows = await discover(now);
      const grouped = groupBySector(rows);
      const already = await existingExternalIds(now);

      const candidates: NativeCandidate[] = [];
      for (const sector of SYNTHESIS_SECTORS) {
        if (candidates.length >= MAX_SYNTHESIS_POSTS_PER_RUN) break;
        const threads = grouped.get(sector) ?? [];

        emit?.({
          stage: "discover",
          identifier: `hn:${sector}`,
          decision: threads.length >= MIN_THREADS_PER_SECTOR ? "pass" : "reject",
          reason:
            threads.length >= MIN_THREADS_PER_SECTOR ? null : "too_few_threads",
          detail:
            threads.length >= MIN_THREADS_PER_SECTOR
              ? undefined
              : `${threads.length} thread(s) < ${MIN_THREADS_PER_SECTOR}`,
          signals: { sector, threads: threads.length, week: isoWeek },
        });
        if (threads.length < MIN_THREADS_PER_SECTOR) continue;

        const externalId = hnSynthesisExternalId(sector, isoWeek);
        if (already.has(externalId)) {
          emit?.({
            stage: "qualify",
            identifier: externalId,
            decision: "reject",
            reason: "already_posted",
            signals: { sector, week: isoWeek },
          });
          continue;
        }
        emit?.({
          stage: "qualify",
          identifier: externalId,
          decision: "pass",
          reason: null,
          signals: {
            sector,
            threads: threads.length,
            top_score: threads[0]!.score,
            week: isoWeek,
          },
        });

        const contextThreads = threads.slice(0, MAX_THREADS_IN_CONTEXT);
        const threadInputs: HnThreadInput[] = contextThreads.map((t) => ({
          title: t.title,
          score: t.score,
          comments: t.comments,
          accessibleCommentary: commentaryOf(t),
        }));
        const inputs: HnSynthesisInputs = {
          sector,
          isoWeek,
          weekLabel,
          threadCount: threads.length,
          threads: threadInputs,
        };

        const outcome = await authorPost(inputs, deps.haiku);
        emit?.({
          stage: "author",
          identifier: externalId,
          decision: outcome.status === "authored" ? "pass" : "reject",
          reason: outcome.status === "authored" ? null : outcome.reason,
          detail:
            outcome.status === "authored"
              ? outcome.output.headline
              : `${outcome.status}: ${outcome.reason}`,
          signals: { sector, threads: threads.length, week: isoWeek },
        });
        if (outcome.status !== "authored") continue;
        const post = outcome.output;

        candidates.push({
          externalId,
          url: contextThreads[0]!.url,
          headline: post.headline,
          body: post.body,
          sector,
          summary: `Weekly HN community synthesis — ${threads.length} ${sector} thread(s), ${weekLabel}.`,
          rawPayload: {
            generator: "hn-community-synthesis",
            sector,
            iso_week: isoWeek,
            week_label: weekLabel,
            thread_count: threads.length,
            threads: contextThreads.map((t) => ({
              title: t.title,
              url: t.url,
              score: t.score,
              comments: t.comments,
            })),
          },
        });
      }

      return candidates.slice(0, MAX_SYNTHESIS_POSTS_PER_RUN);
    },
  };
}

// Default instance registered in generators/index.ts.
export const hnCommunitySynthesisGenerator = createHnCommunitySynthesisGenerator();
