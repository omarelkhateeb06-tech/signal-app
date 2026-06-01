// Phase 12n.4 — tool-spotlight native generator.
//
// AUTHORS at most one native post per run spotlighting a single tool the
// Hacker News community recently surfaced that SIGNAL has NOT yet covered —
// answering the practitioner question "should I spend an afternoon on this
// this week, and why now?"
//
// Sibling to hnRepoDiscovery, but a deliberately different shape:
//   - hnRepoDiscovery does GitHub-API enrichment + a fraud/substance gate and
//     writes a vetting READ on whether a community-surfaced repo is real.
//   - toolSpotlight does NO GitHub call. It works purely from the HN signal
//     SIGNAL already ingested (title + score + comments + repo identity) and
//     writes a forward-looking ADOPTION call. The HN vote is the substance
//     signal; the editorial value is the "why now."
//
//   DISCOVER  github.com repos surfaced on Hacker News in the window, from any
//             HN candidate status (the broad pool), with their score/comments
//             and the HN title. Collapsed to unique repos, highest HN score
//             kept.
//   QUALIFY   drop repos already covered by an ingested OR native event (the
//             "uncovered" rule — a spotlight on something we already wrote is
//             redundant); drop repos below the community-signal floor; dedup by
//             external_id `tool-spotlight:{owner/repo}` so a tool is
//             spotlighted at most once per dedup window.
//   AUTHOR    hand the strongest surviving tool to Haiku, which writes the
//             spotlight or DECLINES when the title is too thin to make a
//             genuine 'why now' case. One Haiku call per run; the 3-tier
//             enrichment seam runs on the authored body.
//
// Cadence: daily if a qualifying uncovered tool exists; skip the day if not.
// Cap 1 post/run — one tool, the strongest community signal of the day.
//
// Slug `tool-spotlight-native` — seeded by migration 0042. The CLI dry-run
// tolerates a missing row; a real run requires it.

import {
  buildToolSpotlightPrompt,
  TOOL_SPOTLIGHT_ASSISTANT_PREFILL,
  TOOL_SPOTLIGHT_MAX_TOKENS,
  type ToolSpotlightInputs,
} from "../../../llm/prompts/ingestion/toolSpotlightPrompt";
import {
  callHaikuForCommentary,
  type HaikuClientDeps,
} from "../../../services/haikuCommentaryClient";
import type { NativeCandidate, NativeGenerator, NativeGeneratorContext } from "./types";
import { parseRepoFromUrl, repoKey } from "./hnRepoDiscovery";
import { z } from "zod";

// ---- Config ----

export const TOOL_SPOTLIGHT_SLUG = "tool-spotlight-native";

// One spotlight per run — the single strongest community signal of the day.
export const MAX_SPOTLIGHT_POSTS_PER_RUN = 1;

// How far back to look for HN-surfaced repos. A tool trending on HN in the
// last few days is the current story; older slots are stale by spotlight
// standards.
export const DISCOVERY_WINDOW_HOURS = 72;

// Community-signal floor. A tool needs real engagement to be worth a
// practitioner's week — below this the "why now" case can't be made from
// social proof alone.
export const MIN_HN_SCORE = 50;

// Look-back for events that already cover a repo (ingested or native). A repo
// surfaced now was almost certainly covered recently if at all; 30 days bounds
// the query while catching any plausible prior coverage.
export const COVERED_WINDOW_DAYS = 30;

// Dedup look-back for this generator's own external_ids. A week keeps a tool
// from being re-spotlighted on consecutive daily runs; past that, a renewed
// surge of attention may justify a fresh look.
export const DEDUP_WINDOW_DAYS = 7;

// ---- Model output contract ----

const ToolSpotlightOutputSchema = z
  .object({
    headline: z.string().min(8).max(200),
    body: z.string().min(200).max(2400),
  })
  .strict();

export type ToolSpotlightOutput = z.infer<typeof ToolSpotlightOutputSchema>;

export type AuthorOutcome =
  | { status: "authored"; output: ToolSpotlightOutput }
  | { status: "skipped"; reason: string }
  | { status: "error"; reason: string };

// ---- Discovery shapes ----

// One raw HN discovery row, before URL parsing — mirrors the SELECT columns.
export interface ToolDiscoveryRow {
  url: string;
  title: string;
  hnScore: number;
  hnComments: number;
}

// One github.com tool surfaced on HN within the window, collapsed to a unique
// repo and carrying the HN signal that selected it.
export interface DiscoveredTool {
  owner: string;
  repo: string;
  fullName: string; // `${owner}/${repo}`, preserving case
  key: string; // lowercased dedup key (repoKey)
  title: string; // the HN submission title
  hnScore: number;
  hnComments: number;
  hnUrl: string; // the original HN-submitted github.com URL
}

// ---- Pure helpers (exported for tests) ----

// Collapse raw HN rows into unique github repos, keeping the highest-HN-score
// sighting of each. Skips rows whose URL doesn't parse to a repo. Returns
// tools ordered by HN score, descending.
export function collapseTools(
  rows: ToolDiscoveryRow[],
  onUnparseable?: (url: string) => void,
): DiscoveredTool[] {
  const byKey = new Map<string, DiscoveredTool>();
  for (const row of rows) {
    const parsed = parseRepoFromUrl(row.url);
    if (!parsed) {
      onUnparseable?.(row.url);
      continue;
    }
    const key = repoKey(parsed.owner, parsed.repo);
    const existing = byKey.get(key);
    if (!existing || row.hnScore > existing.hnScore) {
      byKey.set(key, {
        owner: parsed.owner,
        repo: parsed.repo,
        fullName: `${parsed.owner}/${parsed.repo}`,
        key,
        title: row.title,
        hnScore: row.hnScore,
        hnComments: row.hnComments,
        hnUrl: row.url,
      });
    }
  }
  return [...byKey.values()].sort((a, b) => b.hnScore - a.hnScore);
}

// Build the set of repo keys already covered by an event (ingested or native).
export function coveredRepoKeys(urls: string[]): Set<string> {
  const keys = new Set<string>();
  for (const url of urls) {
    const parsed = parseRepoFromUrl(url);
    if (parsed) keys.add(repoKey(parsed.owner, parsed.repo));
  }
  return keys;
}

// Daily, repo-keyed external_id. No date component: a given tool is
// spotlighted at most once per dedup window, not re-posted day over day.
export function toolSpotlightExternalId(key: string): string {
  return `tool-spotlight:${key}`;
}

// ---- Generator deps (injectable for tests) ----

export interface ToolSpotlightDeps {
  discover?: (now: Date) => Promise<ToolDiscoveryRow[]>;
  coveredUrls?: (now: Date) => Promise<string[]>;
  existingExternalIds?: (now: Date) => Promise<Set<string>>;
  haiku?: HaikuClientDeps;
  authorPost?: (
    inputs: ToolSpotlightInputs,
    haiku?: HaikuClientDeps,
  ) => Promise<AuthorOutcome>;
}

// HN-surfaced github.com candidates in the window, any status (the broad
// pool). Fail-CLOSED: any DB error returns []. Lazy-imports the db so the pure
// helpers above stay import-light and test-friendly.
async function defaultDiscover(now: Date): Promise<ToolDiscoveryRow[]> {
  try {
    const [{ db }, schema, drizzle] = await Promise.all([
      import("../../../db"),
      import("../../../db/schema"),
      import("drizzle-orm"),
    ]);
    const { ingestionCandidates, ingestionSources } = schema;
    const { and, eq, gt, sql } = drizzle;
    const since = new Date(now.getTime() - DISCOVERY_WINDOW_HOURS * 3600 * 1000);
    const rows = await db
      .select({
        url: ingestionCandidates.url,
        title: ingestionCandidates.rawTitle,
        score: sql<string | null>`${ingestionCandidates.rawPayload}->>'score'`,
        comments: sql<string | null>`${ingestionCandidates.rawPayload}->>'descendants'`,
      })
      .from(ingestionCandidates)
      .innerJoin(
        ingestionSources,
        eq(ingestionCandidates.ingestionSourceId, ingestionSources.id),
      )
      .where(
        and(
          eq(ingestionSources.adapterType, "hackernews_api"),
          sql`${ingestionCandidates.url} ILIKE '%github.com%'`,
          gt(ingestionCandidates.discoveredAt, since),
        ),
      );
    return rows
      .filter((r): r is typeof r & { title: string } => Boolean(r.title))
      .map((r) => ({
        url: r.url,
        title: r.title,
        hnScore: r.score ? parseInt(r.score, 10) || 0 : 0,
        hnComments: r.comments ? parseInt(r.comments, 10) || 0 : 0,
      }));
  } catch {
    return [];
  }
}

// Primary-source URLs of events (ingested OR native) in the covered window,
// for the "uncovered" rule. Fail-CLOSED: any DB error returns [] — no dedup
// against events, but the per-source unique constraint on ingestion_candidates
// still prevents a duplicate row.
async function defaultCoveredUrls(now: Date): Promise<string[]> {
  try {
    const [{ db }, schema, drizzle] = await Promise.all([
      import("../../../db"),
      import("../../../db/schema"),
      import("drizzle-orm"),
    ]);
    const { events } = schema;
    const { and, gt, sql } = drizzle;
    const since = new Date(now.getTime() - COVERED_WINDOW_DAYS * 24 * 3600 * 1000);
    const rows = await db
      .select({ url: events.primarySourceUrl })
      .from(events)
      .where(
        and(
          gt(events.createdAt, since),
          sql`${events.primarySourceUrl} ILIKE '%github.com%'`,
        ),
      );
    return rows.map((r) => r.url).filter((u): u is string => Boolean(u));
  } catch {
    return [];
  }
}

// External IDs this generator's source already produced in the dedup window.
// Fail-OPEN: any DB error returns an empty set (the per-source unique
// constraint still blocks a duplicate row on insert).
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
          eq(ingestionSources.slug, TOOL_SPOTLIGHT_SLUG),
          gt(ingestionCandidates.discoveredAt, since),
        ),
      );
    return new Set(rows.map((r) => r.externalId));
  } catch {
    return new Set();
  }
}

async function defaultAuthorPost(
  inputs: ToolSpotlightInputs,
  haiku?: HaikuClientDeps,
): Promise<AuthorOutcome> {
  const prompt = buildToolSpotlightPrompt(inputs);
  const result = await callHaikuForCommentary(prompt, haiku, {
    assistantPrefill: TOOL_SPOTLIGHT_ASSISTANT_PREFILL,
    maxTokens: TOOL_SPOTLIGHT_MAX_TOKENS,
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
  const validated = ToolSpotlightOutputSchema.safeParse(parsed);
  return validated.success
    ? { status: "authored", output: validated.data }
    : { status: "error", reason: "schema_invalid" };
}

// Human label for the prompt's recency framing.
function dateLabelOf(now: Date): string {
  return now.toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// Sector tag for spotlight posts. Tools surfaced on HN are overwhelmingly
// developer/AI tooling; "ai" is the home feed for a code tool. (A future
// language-classification pass could route finance/semis tooling, but the HN
// github pool is ~entirely AI/dev today.)
const SPOTLIGHT_SECTOR = "ai" as const;

export function createToolSpotlightGenerator(
  deps: ToolSpotlightDeps = {},
): NativeGenerator {
  const discover = deps.discover ?? defaultDiscover;
  const coveredUrls = deps.coveredUrls ?? defaultCoveredUrls;
  const existingExternalIds =
    deps.existingExternalIds ?? defaultExistingExternalIds;
  const authorPost = deps.authorPost ?? defaultAuthorPost;

  return {
    slug: TOOL_SPOTLIGHT_SLUG,
    async generate(ctx: NativeGeneratorContext): Promise<NativeCandidate[]> {
      const now = ctx.now();
      const emit = ctx.onDiagnostic;

      // 1) DISCOVER — HN-surfaced github repos in the window, collapsed to
      // unique repos by highest HN score.
      const rawRows = await discover(now);
      const discovered = collapseTools(rawRows, (url) => {
        emit?.({
          stage: "discover",
          identifier: url,
          url,
          decision: "reject",
          reason: "unparseable_url",
        });
      });

      // 2) QUALIFY — drop covered repos, below-floor signal, and already-
      // posted tools; keep the strongest survivor.
      const covered = coveredRepoKeys(await coveredUrls(now));
      const already = await existingExternalIds(now);

      let chosen: DiscoveredTool | null = null;
      for (const tool of discovered) {
        const externalId = toolSpotlightExternalId(tool.key);
        let reason: string | null = null;
        if (tool.hnScore < MIN_HN_SCORE) reason = "below_signal_floor";
        else if (covered.has(tool.key)) reason = "already_covered";
        else if (already.has(externalId)) reason = "already_posted";

        emit?.({
          stage: "qualify",
          identifier: tool.fullName,
          url: tool.hnUrl,
          decision: reason ? "reject" : "pass",
          reason,
          detail:
            reason === "below_signal_floor"
              ? `hn_score ${tool.hnScore} < ${MIN_HN_SCORE}`
              : undefined,
          signals: { hn_score: tool.hnScore, hn_comments: tool.hnComments },
        });
        if (reason) continue;
        chosen = tool;
        break; // discovered is HN-score-descending; first survivor is strongest
      }

      if (!chosen) return [];

      // 3) AUTHOR — hand the strongest tool to Haiku.
      const externalId = toolSpotlightExternalId(chosen.key);
      const dateLabel = dateLabelOf(now);
      const inputs: ToolSpotlightInputs = {
        fullName: chosen.fullName,
        hnTitle: chosen.title,
        hnScore: chosen.hnScore,
        hnComments: chosen.hnComments,
        repoUrl: chosen.hnUrl,
        dateLabel,
      };

      const outcome = await authorPost(inputs, deps.haiku);
      emit?.({
        stage: "author",
        identifier: externalId,
        url: chosen.hnUrl,
        decision: outcome.status === "authored" ? "pass" : "reject",
        reason: outcome.status === "authored" ? null : outcome.reason,
        detail:
          outcome.status === "authored"
            ? outcome.output.headline
            : `${outcome.status}: ${outcome.reason}`,
        signals: { hn_score: chosen.hnScore, hn_comments: chosen.hnComments },
      });
      if (outcome.status !== "authored") return [];
      const post = outcome.output;

      const candidate: NativeCandidate = {
        externalId,
        url: chosen.hnUrl,
        headline: post.headline,
        body: post.body,
        sector: SPOTLIGHT_SECTOR,
        summary: `Tool spotlight — ${chosen.fullName}, ${dateLabel}.`,
        rawPayload: {
          generator: "tool-spotlight",
          full_name: chosen.fullName,
          repo_key: chosen.key,
          hn_title: chosen.title,
          hn_score: chosen.hnScore,
          hn_comments: chosen.hnComments,
          hn_url: chosen.hnUrl,
          date: dateLabel,
        },
      };

      return [candidate];
    },
  };
}

// Default instance registered in generators/index.ts.
export const toolSpotlightGenerator = createToolSpotlightGenerator();
