import type { NextFunction, Request, Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { storyAggregates } from "../../db/schema";
import { AppError } from "../../middleware/errorHandler";
import { AGGREGATED_SECTORS } from "../../jobs/aggregationJob";

const DEFAULT_WINDOW = 8;
const MAX_WINDOW = 52;

const paramsSchema = z.object({
  sector: z.enum(AGGREGATED_SECTORS),
});

const querySchema = z.object({
  weeks: z.coerce.number().int().min(2).max(MAX_WINDOW).default(DEFAULT_WINDOW),
});

/**
 * Volume-based weekly momentum: percent change from last week to this week,
 * floored at `last_week = 1` to avoid divide-by-zero and the spike-of-
 * infinity that 0→N would otherwise produce. Positive = up, negative =
 * down, `null` when the caller asked for fewer than 2 data points (can't
 * compute a delta with a single week).
 */
export function computeMomentum(series: { storyCount: number }[]): number | null {
  if (series.length < 2) return null;
  // `series` is returned newest-first; this week = index 0, last week = 1.
  const thisWeek = series[0]!.storyCount;
  const lastWeek = series[1]!.storyCount;
  const denom = Math.max(lastWeek, 1);
  return (thisWeek - lastWeek) / denom;
}

export async function getSectorTrends(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const paramParse = paramsSchema.safeParse(req.params);
    if (!paramParse.success) {
      throw new AppError(
        "INVALID_SECTOR",
        `Sector must be one of: ${AGGREGATED_SECTORS.join(", ")}`,
        400,
        paramParse.error.flatten(),
      );
    }
    const queryParse = querySchema.safeParse(req.query);
    if (!queryParse.success) {
      throw new AppError(
        "INVALID_QUERY",
        "Invalid query parameters",
        400,
        queryParse.error.flatten(),
      );
    }

    const { sector } = paramParse.data;
    const { weeks } = queryParse.data;

    const rows = await db
      .select({
        period: storyAggregates.period,
        storyCount: storyAggregates.storyCount,
        saveCount: storyAggregates.saveCount,
        computedAt: storyAggregates.computedAt,
      })
      .from(storyAggregates)
      .where(and(eq(storyAggregates.sector, sector)))
      .orderBy(desc(storyAggregates.period))
      .limit(weeks);

    const momentum = computeMomentum(rows);
    const asOf = rows[0]?.computedAt ?? null;

    res.json({
      data: {
        sector,
        as_of: asOf,
        momentum,
        series: rows.map((r) => ({
          period: r.period,
          story_count: r.storyCount,
          save_count: r.saveCount,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
}
