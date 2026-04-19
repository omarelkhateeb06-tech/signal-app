import { and, desc, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "../db";
import { stories } from "../db/schema";
import type { DigestStory } from "../emails/weeklyDigestEmail";

export const DEFAULT_DIGEST_SIZE = 6;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface DigestWindow {
  start: Date;
  end: Date;
  label: string;
}

export function currentDigestWindow(now: Date = new Date()): DigestWindow {
  const end = new Date(now);
  end.setUTCHours(0, 0, 0, 0);
  const start = new Date(end.getTime() - WEEK_MS);
  return { start, end, label: formatWeekLabel(start, end) };
}

function formatWeekLabel(start: Date, end: Date): string {
  const fmt: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  const startLabel = new Intl.DateTimeFormat("en-US", { ...fmt, timeZone: "UTC" }).format(start);
  const endOpts: Intl.DateTimeFormatOptions = sameYear
    ? { ...fmt, timeZone: "UTC" }
    : { ...fmt, year: "numeric", timeZone: "UTC" };
  const endLabel = new Intl.DateTimeFormat("en-US", endOpts).format(end);
  return `${startLabel} – ${endLabel}`;
}

export interface CompileDigestOptions {
  sectors?: string[] | null;
  limit?: number;
  window?: DigestWindow;
}

export async function compileDigest(
  options: CompileDigestOptions = {},
): Promise<{ window: DigestWindow; stories: DigestStory[] }> {
  const window = options.window ?? currentDigestWindow();
  const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_DIGEST_SIZE, 20));

  const filters = [
    gte(stories.createdAt, window.start),
    lte(stories.createdAt, window.end),
  ];
  if (options.sectors && options.sectors.length > 0) {
    filters.push(inArray(stories.sector, options.sectors));
  }

  const saveCountExpr = sql<number>`(SELECT COUNT(*)::int FROM user_saves us WHERE us.story_id = ${stories.id})`;
  const commentCountExpr = sql<number>`(SELECT COUNT(*)::int FROM comments c WHERE c.story_id = ${stories.id} AND c.deleted_at IS NULL)`;
  const scoreExpr = sql<number>`(${saveCountExpr} * 2 + ${commentCountExpr})`;

  const rows = await db
    .select({
      id: stories.id,
      sector: stories.sector,
      headline: stories.headline,
      context: stories.context,
      whyItMatters: stories.whyItMatters,
      sourceName: stories.sourceName,
      publishedAt: stories.publishedAt,
      createdAt: stories.createdAt,
      saveCount: saveCountExpr,
      commentCount: commentCountExpr,
      score: scoreExpr,
    })
    .from(stories)
    .where(and(...filters))
    .orderBy(desc(scoreExpr), desc(stories.publishedAt), desc(stories.createdAt))
    .limit(limit);

  const shaped: DigestStory[] = rows.map((r) => ({
    id: r.id,
    sector: r.sector,
    headline: r.headline,
    context: r.context,
    whyItMatters: r.whyItMatters,
    sourceName: r.sourceName,
    publishedAt: r.publishedAt ?? r.createdAt,
    saveCount: Number(r.saveCount ?? 0),
    commentCount: Number(r.commentCount ?? 0),
  }));

  return { window, stories: shaped };
}
