import { and, gte, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { stories, storyAggregates } from "../db/schema";

// Sectors are codified at the job boundary so that a week with zero stories
// in one sector still produces a zero-count row — downstream momentum
// calculation needs (this_week, last_week) pairs with no missing sides.
export const AGGREGATED_SECTORS = ["ai", "finance", "semiconductors"] as const;
export type AggregatedSector = (typeof AGGREGATED_SECTORS)[number];

export interface AggregationRunResult {
  period: string;
  processed: number;
  sectors: { sector: AggregatedSector; storyCount: number; saveCount: number }[];
}

// ISO-8601 week string ("2026-W16"). The year is the Thursday-in-the-week's
// year, not the calendar year of the passed date — so Jan 1 2027 is in
// "2026-W53" if that Jan 1 is a Friday, which matches Postgres's EXTRACT
// semantics and how Monday-start week buckets read in human reports.
export function toIsoWeek(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstThursdayDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstThursdayDayNum + 3);
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

// [start, end) — Monday 00:00:00 UTC inclusive to next Monday 00:00:00 UTC
// exclusive. Exclusive upper bound keeps the `published_at < end` query
// tidy and avoids the "published at exactly 23:59:59.999" edge case.
export function weekBounds(period: string): { start: Date; end: Date } {
  const match = /^(\d{4})-W(\d{2})$/.exec(period);
  if (!match) {
    throw new Error(`aggregation: invalid ISO week "${period}" (expected "YYYY-Www")`);
  }
  const year = Number(match[1]);
  const week = Number(match[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4DayNum = (jan4.getUTCDay() + 6) % 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - jan4DayNum);
  const start = new Date(week1Monday);
  start.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 7);
  return { start, end };
}

export interface RunAggregationOptions {
  period?: string;
  now?: Date;
}

/**
 * Recomputes per-sector story counts for the given ISO week (defaults to
 * the week of `now`) and upserts them into `story_aggregates`. Idempotent:
 * re-running against the same period updates counts and bumps
 * `computed_at`/`updated_at`. `save_count` is always 0 in v1 (see the
 * schema comment — reserved column, no user_saves JOIN yet).
 */
export async function runAggregation(
  opts: RunAggregationOptions = {},
): Promise<AggregationRunResult> {
  const now = opts.now ?? new Date();
  const period = opts.period ?? toIsoWeek(now);
  const { start, end } = weekBounds(period);

  const rows = await db
    .select({
      sector: stories.sector,
      storyCount: sql<number>`count(*)::int`,
    })
    .from(stories)
    .where(
      and(
        isNotNull(stories.publishedAt),
        gte(stories.publishedAt, start),
        lt(stories.publishedAt, end),
      ),
    )
    .groupBy(stories.sector);

  const byKnownSector = new Map<AggregatedSector, number>();
  for (const row of rows) {
    if ((AGGREGATED_SECTORS as readonly string[]).includes(row.sector)) {
      byKnownSector.set(row.sector as AggregatedSector, Number(row.storyCount));
    }
  }

  const values = AGGREGATED_SECTORS.map((sector) => ({
    sector,
    period,
    storyCount: byKnownSector.get(sector) ?? 0,
    saveCount: 0,
  }));

  await db
    .insert(storyAggregates)
    .values(values)
    .onConflictDoUpdate({
      target: [storyAggregates.sector, storyAggregates.period],
      set: {
        storyCount: sql`excluded.story_count`,
        saveCount: sql`excluded.save_count`,
        computedAt: sql`now()`,
        updatedAt: sql`now()`,
      },
    });

  return {
    period,
    processed: values.length,
    sectors: values.map((v) => ({
      sector: v.sector,
      storyCount: v.storyCount,
      saveCount: v.saveCount,
    })),
  };
}

// Thin BullMQ-level wrapper so the worker has a single named entry point.
export async function processAggregationJob(
  data: { period?: string } = {},
): Promise<AggregationRunResult> {
  return runAggregation({ period: data.period });
}

// Test-only accessor — keeps the sector-check closure testable without
// exporting a mutable array.
export function getEligibleAggregateSector(value: string): AggregatedSector | null {
  return (AGGREGATED_SECTORS as readonly string[]).includes(value)
    ? (value as AggregatedSector)
    : null;
}
