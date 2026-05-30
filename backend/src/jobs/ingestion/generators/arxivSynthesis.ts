// Phase 12n.x — arXiv weekly-synthesis native generator.
//
// AUTHORS one native post per qualifying sector summarizing the DIRECTION of
// the week's arXiv research SIGNAL already ingested. Unlike the HN-repo
// generator (one post per discovered artifact), this is a SYNTHESIS: one
// post covering multiple papers. The editorial value is the through-line —
// "what theme emerged this week" — not a list of paper summaries.
//
//   DISCOVER  published arXiv events from the last 7 days (the `events`
//             table — already enriched, tier content + facts exist). No
//             re-fetch, no GitHub-style API enrichment; the papers' own
//             `accessible` tier thesis IS the distilled signal.
//   QUALIFY   per sector: ≥2 papers in the window. No substance gate —
//             published events already cleared SIGNAL's relevance bar.
//             Dedup by external_id `arxiv-synthesis:{sector}:{ISO-week}` so
//             a week is never double-posted.
//   AUTHOR    hand up to 5 papers' titles + theses to Haiku, which names the
//             pattern across them (one Haiku call per sector). The standard
//             3-tier enrichment seam then runs on the authored body.
//
// Sector scope: AI and Semiconductors. Each qualifying sector yields one
// post (cap 2/run). Finance is out — research synthesis isn't the finance
// signal (filings/earnings are; those land in 12n.3).
//
// Slug `arxiv-synthesis-native` — seeded by migration 0038. The CLI dry-run
// tolerates a missing row; a real run requires it.

import {
  ARXIV_SYNTHESIS_ASSISTANT_PREFILL,
  ARXIV_SYNTHESIS_MAX_TOKENS,
  buildArxivSynthesisPrompt,
  type ArxivPaperInput,
  type ArxivSynthesisInputs,
} from "../../../llm/prompts/ingestion/arxivSynthesisPrompt";
import { callHaikuForCommentary, type HaikuClientDeps } from "../../../services/haikuCommentaryClient";
import { parseTierTemplate } from "../../../utils/depthVariants";
import { VALID_SECTORS, type Sector } from "../relevanceSeam";
import { isoWeekOf, weekLabelOf } from "./isoWeek";
import type { NativeCandidate, NativeGenerator, NativeGeneratorContext } from "./types";
import { z } from "zod";

// ---- Config ----

export const ARXIV_SYNTHESIS_SLUG = "arxiv-synthesis-native";

// One post per qualifying sector; with two scoped sectors the natural cap is
// 2. Sliced explicitly to stay within the ~10/day native budget.
export const MAX_SYNTHESIS_POSTS_PER_RUN = 2;

// Weekly cadence: the synthesis covers the prior 7 days of published events.
export const SYNTHESIS_WINDOW_DAYS = 7;

// A "synthesis" needs at least two papers to have a through-line. One paper
// is a per-item post, which this generator deliberately is not.
export const MIN_PAPERS_PER_SECTOR = 2;

// Cap on papers fed to the prompt. Beyond ~5 the model can't hold a tight
// thesis; the newest are the most representative of "this week".
export const MAX_PAPERS_IN_CONTEXT = 5;

// Sectors this generator synthesizes. Finance research isn't the finance
// signal (filings/earnings are — 12n.3). Order is the run priority.
export const SYNTHESIS_SECTORS: readonly Sector[] = ["ai", "semiconductors"];

// Dedup look-back for already-authored weekly external_ids. One day past the
// content window so a late re-run in the same ISO week still sees the prior
// post.
export const DEDUP_WINDOW_DAYS = SYNTHESIS_WINDOW_DAYS + 1;

// ---- Model output contract ----

const ArxivSynthesisOutputSchema = z
  .object({
    headline: z.string().min(8).max(200),
    body: z.string().min(200).max(2400),
  })
  .strict();

export type ArxivSynthesisOutput = z.infer<typeof ArxivSynthesisOutputSchema>;

export type AuthorOutcome =
  | { status: "authored"; output: ArxivSynthesisOutput }
  | { status: "skipped"; reason: string }
  | { status: "error"; reason: string };

// ---- Discovery shapes ----

// One published arXiv event row, as the discover dep returns it. Mirrors the
// SELECT columns; the generator distills `accessibleThesis` from these.
export interface ArxivEventRow {
  sector: string;
  headline: string;
  template: string | null; // events.why_it_matters_template (TierTemplate JSON)
  genericCommentary: string | null;
  whyItMatters: string;
  publishedAt: string | null;
  url: string; // events.primary_source_url
}

// ---- Pure helpers (exported for tests) ----

// Distill a row to its one-sentence "why it matters". Prefers the per-tier
// `accessible.thesis` (the canonical distilled signal); falls back to
// generic_commentary, then the role-neutral why_it_matters string.
export function accessibleThesisOf(row: ArxivEventRow): string {
  const tmpl = parseTierTemplate(row.template);
  if (tmpl) return tmpl.accessible.thesis;
  if (row.genericCommentary && row.genericCommentary.trim().length > 0) {
    return row.genericCommentary.trim();
  }
  return row.whyItMatters;
}

function isSector(value: string): value is Sector {
  return (VALID_SECTORS as readonly string[]).includes(value);
}

// Group discovered rows by the sectors this generator scopes, newest first.
// Rows in out-of-scope sectors (e.g. finance) are dropped.
export function groupBySector(
  rows: ArxivEventRow[],
): Map<Sector, ArxivEventRow[]> {
  const byScore = (a: ArxivEventRow, b: ArxivEventRow): number => {
    const at = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const bt = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    return bt - at;
  };
  const grouped = new Map<Sector, ArxivEventRow[]>();
  for (const row of rows) {
    if (!isSector(row.sector)) continue;
    if (!SYNTHESIS_SECTORS.includes(row.sector)) continue;
    const list = grouped.get(row.sector) ?? [];
    list.push(row);
    grouped.set(row.sector, list);
  }
  for (const list of grouped.values()) list.sort(byScore);
  return grouped;
}

export function arxivSynthesisExternalId(sector: Sector, isoWeek: string): string {
  return `arxiv-synthesis:${sector}:${isoWeek}`;
}

// ---- Generator deps (injectable for tests) ----

export interface ArxivSynthesisDeps {
  // Published arXiv events in the window. Tests inject canned rows;
  // production reads the `events` table.
  discover?: (now: Date) => Promise<ArxivEventRow[]>;
  // External IDs this generator already authored in the dedup window, for
  // weekly cadence enforcement. Tests inject; production reads candidates.
  existingExternalIds?: (now: Date) => Promise<Set<string>>;
  haiku?: HaikuClientDeps;
  authorPost?: (
    inputs: ArxivSynthesisInputs,
    haiku?: HaikuClientDeps,
  ) => Promise<AuthorOutcome>;
}

// Discover published arXiv events in the window. Fail-CLOSED: any DB error
// returns []. Lazy-imports the db so the pure helpers stay import-light.
async function defaultDiscover(now: Date): Promise<ArxivEventRow[]> {
  try {
    const [{ db }, schema, drizzle] = await Promise.all([
      import("../../../db"),
      import("../../../db/schema"),
      import("drizzle-orm"),
    ]);
    const { events } = schema;
    const { and, eq, gt, sql } = drizzle;
    const since = new Date(now.getTime() - SYNTHESIS_WINDOW_DAYS * 24 * 3600 * 1000);
    const rows = await db
      .select({
        sector: events.sector,
        headline: events.headline,
        template: events.whyItMattersTemplate,
        genericCommentary: events.genericCommentary,
        whyItMatters: events.whyItMatters,
        publishedAt: events.publishedAt,
        url: events.primarySourceUrl,
      })
      .from(events)
      .where(
        and(
          eq(events.sourceType, "ingested"),
          sql`${events.primarySourceUrl} ILIKE '%arxiv.org%'`,
          gt(events.createdAt, since),
        ),
      );
    return rows.map((r) => ({
      sector: r.sector,
      headline: r.headline,
      template: r.template,
      genericCommentary: r.genericCommentary,
      whyItMatters: r.whyItMatters,
      publishedAt:
        r.publishedAt instanceof Date
          ? r.publishedAt.toISOString()
          : (r.publishedAt as string | null),
      url: r.url,
    }));
  } catch {
    return [];
  }
}

// External IDs this generator's source already produced in the dedup window.
// Fail-OPEN: any DB error returns an empty set (the per-source unique
// constraint on ingestion_candidates still blocks a duplicate row on insert).
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
          eq(ingestionSources.slug, ARXIV_SYNTHESIS_SLUG),
          gt(ingestionCandidates.discoveredAt, since),
        ),
      );
    return new Set(rows.map((r) => r.externalId));
  } catch {
    return new Set();
  }
}

async function defaultAuthorPost(
  inputs: ArxivSynthesisInputs,
  haiku?: HaikuClientDeps,
): Promise<AuthorOutcome> {
  const prompt = buildArxivSynthesisPrompt(inputs);
  const result = await callHaikuForCommentary(prompt, haiku, {
    assistantPrefill: ARXIV_SYNTHESIS_ASSISTANT_PREFILL,
    maxTokens: ARXIV_SYNTHESIS_MAX_TOKENS,
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
  const validated = ArxivSynthesisOutputSchema.safeParse(parsed);
  return validated.success
    ? { status: "authored", output: validated.data }
    : { status: "error", reason: "schema_invalid" };
}

export function createArxivSynthesisGenerator(
  deps: ArxivSynthesisDeps = {},
): NativeGenerator {
  const discover = deps.discover ?? defaultDiscover;
  const existingExternalIds =
    deps.existingExternalIds ?? defaultExistingExternalIds;
  const authorPost = deps.authorPost ?? defaultAuthorPost;

  return {
    slug: ARXIV_SYNTHESIS_SLUG,
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
        const papers = grouped.get(sector) ?? [];

        emit?.({
          stage: "discover",
          identifier: `arxiv:${sector}`,
          decision: papers.length >= MIN_PAPERS_PER_SECTOR ? "pass" : "reject",
          reason: papers.length >= MIN_PAPERS_PER_SECTOR ? null : "too_few_papers",
          detail:
            papers.length >= MIN_PAPERS_PER_SECTOR
              ? undefined
              : `${papers.length} paper(s) < ${MIN_PAPERS_PER_SECTOR}`,
          signals: { sector, papers: papers.length, week: isoWeek },
        });
        if (papers.length < MIN_PAPERS_PER_SECTOR) continue;

        const externalId = arxivSynthesisExternalId(sector, isoWeek);
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
          signals: { sector, papers: papers.length, week: isoWeek },
        });

        const contextPapers = papers.slice(0, MAX_PAPERS_IN_CONTEXT);
        const paperInputs: ArxivPaperInput[] = contextPapers.map((p) => ({
          title: p.headline,
          accessibleThesis: accessibleThesisOf(p),
          publishedAt: p.publishedAt,
        }));
        const inputs: ArxivSynthesisInputs = {
          sector,
          isoWeek,
          weekLabel,
          paperCount: papers.length,
          papers: paperInputs,
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
          signals: { sector, papers: papers.length, week: isoWeek },
        });
        if (outcome.status !== "authored") continue;
        const post = outcome.output;

        candidates.push({
          externalId,
          url: contextPapers[0]!.url,
          headline: post.headline,
          body: post.body,
          sector,
          summary: `Weekly arXiv synthesis — ${papers.length} ${sector} paper(s), ${weekLabel}.`,
          rawPayload: {
            generator: "arxiv-synthesis",
            sector,
            iso_week: isoWeek,
            week_label: weekLabel,
            paper_count: papers.length,
            papers: contextPapers.map((p) => ({
              title: p.headline,
              url: p.url,
              published_at: p.publishedAt,
            })),
          },
        });
      }

      return candidates.slice(0, MAX_SYNTHESIS_POSTS_PER_RUN);
    },
  };
}

// Default instance registered in generators/index.ts.
export const arxivSynthesisGenerator = createArxivSynthesisGenerator();
