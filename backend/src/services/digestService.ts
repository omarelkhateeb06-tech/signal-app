// Phase 12i — daily digest service. Replaces the Phase 7 weekly digest
// compile path. Two changes from the prior version:
//
//   1. Window: trailing 24 hours instead of trailing 7 days. The cron
//      fires at 11:00 UTC; selection is `published_at > now() - 24h`.
//
//   2. Ranking: editorial 12f effective_score (events) + a static
//      baseline (legacy stories) — same scoring as the in-app feed,
//      not the save-count + comment-count proxy the weekly digest
//      used. Events with no enabled source are excluded (same hotfix
//      #88 predicate the feed uses).
//
// The digest is Pro-only at the dispatch layer (sendDailyDigests filters
// by tier). This service is dispatch-tier-agnostic — it compiles the
// rows that *would* go into a Pro user's email for their sectors.
//
// Free-tier-style read of role-neutral text: prefer `generic_commentary`
// (12g column, populated by writeEvent + the backfill script), fall
// back to `why_it_matters` for pre-12g rows, fall back to headline-
// only as the last resort. The dispatch path never personalizes — daily
// digest content is identical for every Pro user in a sector cohort.

import { and, desc, gte, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { events, stories } from "../db/schema";
import {
  STORY_BASELINE_EFFECTIVE_SCORE,
  eventEffectiveScoreExpr,
  eventHasEnabledSourceExpr,
} from "../controllers/storyController";

export const DAILY_DIGEST_SIZE = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface DailyDigestWindow {
  start: Date;
  // The send moment, used for the "May 17" header label on the email.
  // Defaults to now() at compile time.
  sentAt: Date;
  label: string;
}

export function currentDailyWindow(now: Date = new Date()): DailyDigestWindow {
  const sentAt = new Date(now);
  const start = new Date(sentAt.getTime() - DAY_MS);
  return { start, sentAt, label: formatDayLabel(sentAt) };
}

function formatDayLabel(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export interface DailyDigestStory {
  id: string;
  sector: string;
  headline: string;
  // Role-neutral body. Chained per the read-side fallback rule above —
  // never personalized. Empty string allowed when neither column has
  // usable text (the email template renders headline-only in that case).
  commentary: string;
  sourceName: string | null;
  publishedAt: Date;
}

export interface CompileDailyDigestOptions {
  sectors?: string[] | null;
  limit?: number;
  window?: DailyDigestWindow;
}

export interface CompiledDailyDigest {
  window: DailyDigestWindow;
  stories: DailyDigestStory[];
  // Pre-grouped for the email template — preserves the rank ordering
  // within each sector. Sectors with zero matching stories are omitted.
  bySector: Map<string, DailyDigestStory[]>;
}

/**
 * Resolve the role-neutral commentary text for a row. Empty when both
 * sources are missing — the template renders headline-only in that
 * case.
 */
function pickCommentary(
  whyItMatters: string | null,
  genericCommentary: string | null,
): string {
  const generic = genericCommentary?.trim() ?? "";
  if (generic.length > 0) return generic;
  return whyItMatters?.trim() ?? "";
}

/**
 * Group an already-ranked list by sector while preserving the input
 * order. Sectors first appear in the order their first ranked row
 * appears — so a single high-ranked Finance story above many AI rows
 * still surfaces Finance first.
 */
function groupBySector(
  rows: DailyDigestStory[],
): Map<string, DailyDigestStory[]> {
  const out = new Map<string, DailyDigestStory[]>();
  for (const row of rows) {
    const arr = out.get(row.sector);
    if (arr) arr.push(row);
    else out.set(row.sector, [row]);
  }
  return out;
}

export async function compileDailyDigest(
  options: CompileDailyDigestOptions = {},
): Promise<CompiledDailyDigest> {
  const window = options.window ?? currentDailyWindow();
  const limit = Math.max(1, Math.min(options.limit ?? DAILY_DIGEST_SIZE, 50));
  const sectors =
    options.sectors && options.sectors.length > 0 ? options.sectors : null;

  // Stories side — legacy hand-curated content. No SQL-level ranking
  // inputs (no save_count / event_sources), so we tag every row with
  // the STORY_BASELINE_EFFECTIVE_SCORE constant for the merge step.
  const storyFilters = [gte(stories.publishedAt, window.start)];
  if (sectors) storyFilters.push(inArray(stories.sector, sectors));

  const storyRows = await db
    .select({
      id: stories.id,
      sector: stories.sector,
      headline: stories.headline,
      whyItMatters: stories.whyItMatters,
      genericCommentary: stories.genericCommentary,
      sourceName: stories.sourceName,
      publishedAt: stories.publishedAt,
      createdAt: stories.createdAt,
    })
    .from(stories)
    .where(and(...storyFilters))
    .limit(limit);

  // Events side — 12f effective_score ranking, hotfix-#88 enabled-
  // source filter. Computed at the SQL layer for parity with the feed.
  const eventEffectiveScore = eventEffectiveScoreExpr();
  const eventFilters = [
    gte(events.publishedAt, window.start),
    eventHasEnabledSourceExpr(),
  ];
  if (sectors) eventFilters.push(inArray(events.sector, sectors));

  const eventRows = await db
    .select({
      id: events.id,
      sector: events.sector,
      headline: events.headline,
      whyItMatters: events.whyItMatters,
      genericCommentary: events.genericCommentary,
      sourceName: events.primarySourceName,
      publishedAt: events.publishedAt,
      createdAt: events.createdAt,
      effectiveScore: eventEffectiveScore,
    })
    .from(events)
    .where(and(...eventFilters))
    .orderBy(desc(eventEffectiveScore))
    .limit(limit);

  type Scored = { row: DailyDigestStory; score: number; ts: number };
  const merged: Scored[] = [
    ...storyRows.map((r): Scored => ({
      row: {
        id: r.id,
        sector: r.sector,
        headline: r.headline,
        commentary: pickCommentary(r.whyItMatters, r.genericCommentary),
        sourceName: r.sourceName,
        publishedAt: r.publishedAt ?? r.createdAt,
      },
      score: STORY_BASELINE_EFFECTIVE_SCORE,
      ts: (r.publishedAt ?? r.createdAt).getTime(),
    })),
    ...eventRows.map((r): Scored => ({
      row: {
        id: r.id,
        sector: r.sector,
        headline: r.headline,
        commentary: pickCommentary(r.whyItMatters, r.genericCommentary),
        sourceName: r.sourceName,
        publishedAt: r.publishedAt ?? r.createdAt,
      },
      // pg can return numeric as string on some configurations.
      score: Number(r.effectiveScore),
      ts: (r.publishedAt ?? r.createdAt).getTime(),
    })),
  ];

  merged.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.ts - a.ts; // newer first as the tiebreaker
  });

  const top = merged.slice(0, limit).map((m) => m.row);
  return { window, stories: top, bySector: groupBySector(top) };
}

// Re-exports retained for the CLI / schedulers that still import these
// names. Future cleanup can drop them.
export { DAY_MS };

// Touch sql to keep the import alive in lint configurations that
// strip unused symbols — composite queries above use sql via the
// helper exprs, so this is purely an explicitness anchor.
void sql;
