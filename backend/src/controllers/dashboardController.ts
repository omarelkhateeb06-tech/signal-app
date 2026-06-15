// Dashboard — coverage/activity stats over SIGNAL's own event corpus.
//
// This is the honest, no-keys dashboard: it reports what we can measure from
// the events table today (how much we're covering, per sector, over time).
// The richer reader-facing market modules the roadmap envisions (compute-cost
// tracker, supply index, macro) need the gated external data feeds (FRED etc.)
// and plug into this surface later.
//
// The SQL aggregation isn't unit-testable without Postgres; the row→wire
// mapping is, so `shapeDashboard` is split out and tested directly.

import type { Request, Response, NextFunction } from "express";
import { sql } from "drizzle-orm";

import { db } from "../db";
import { events } from "../db/schema";

const SECTOR_WINDOW_DAYS = 30;
const VOLUME_WINDOW_DAYS = 14;

export interface DashboardData {
  total_events_30d: number;
  sector_counts: Array<{ sector: string; count: number }>;
  volume_by_day: Array<{ date: string; count: number }>;
}

export function shapeDashboard(
  sectorRows: Record<string, unknown>[],
  volumeRows: Record<string, unknown>[],
): DashboardData {
  const sector_counts = sectorRows.map((r) => ({
    sector: String(r.sector),
    count: Number(r.count),
  }));
  const volume_by_day = volumeRows.map((r) => ({
    date: String(r.date),
    count: Number(r.count),
  }));
  const total_events_30d = sector_counts.reduce((sum, r) => sum + r.count, 0);
  return { total_events_30d, sector_counts, volume_by_day };
}

export async function getDashboard(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const sectorRes = await db.execute(sql`
      SELECT sector, COUNT(*)::int AS count
      FROM ${events}
      WHERE COALESCE(${events.publishedAt}, ${events.createdAt})
            > NOW() - make_interval(days => ${SECTOR_WINDOW_DAYS})
      GROUP BY sector
      ORDER BY count DESC
    `);
    const volumeRes = await db.execute(sql`
      SELECT to_char(
               date_trunc('day', COALESCE(${events.publishedAt}, ${events.createdAt})),
               'YYYY-MM-DD'
             ) AS date,
             COUNT(*)::int AS count
      FROM ${events}
      WHERE COALESCE(${events.publishedAt}, ${events.createdAt})
            > NOW() - make_interval(days => ${VOLUME_WINDOW_DAYS})
      GROUP BY 1
      ORDER BY 1
    `);

    const sectorRows =
      (sectorRes as { rows?: Record<string, unknown>[] }).rows ?? [];
    const volumeRows =
      (volumeRes as { rows?: Record<string, unknown>[] }).rows ?? [];

    res.json({ data: shapeDashboard(sectorRows, volumeRows) });
  } catch (error) {
    next(error);
  }
}
