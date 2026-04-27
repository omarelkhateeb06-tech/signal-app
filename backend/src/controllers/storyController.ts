import type { NextFunction, Request, Response } from "express";
import { and, desc, eq, gte, inArray, lte, ne, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { stories, userProfiles, userSaves, writers } from "../db/schema";
import { AppError } from "../middleware/errorHandler";
import { personalizeStory } from "../services/personalizationService";

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 10;
const RELATED_LIMIT = 5;

const feedQuerySchema = z.object({
  sectors: z
    .string()
    .optional()
    .transform((raw) =>
      raw
        ? raw
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s.length > 0)
        : [],
    ),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  offset: z.coerce.number().int().min(0).default(0),
});

const idParamSchema = z.object({ id: z.string().uuid() });

function requireUserId(req: Request): string {
  if (!req.user) {
    throw new AppError("UNAUTHORIZED", "Not authenticated", 401);
  }
  return req.user.userId;
}

interface StoryRow {
  id: string;
  sector: string;
  headline: string;
  context: string;
  whyItMatters: string;
  whyItMattersTemplate: string | null;
  sourceUrl: string;
  sourceName: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  authorId: string | null;
  authorName: string | null;
  authorBio: string | null;
  isSaved: boolean;
  saveCount: number;
  commentCount: number;
}

function shapeStory(row: StoryRow, role: string | null): Record<string, unknown> {
  return {
    id: row.id,
    sector: row.sector,
    headline: row.headline,
    context: row.context,
    why_it_matters: row.whyItMatters,
    // Phase 12b personalization output — kept on the payload for
    // backward compatibility through the 12c rollout. The 12c client
    // prefers `commentary` once it arrives; the 12b field will be
    // removed in the 12d cleanup commit.
    why_it_matters_to_you: personalizeStory({
      whyItMatters: row.whyItMatters,
      whyItMattersTemplate: row.whyItMattersTemplate,
      role,
    }),
    // Phase 12c contract: feed-list responses never carry the
    // per-user commentary inline. The client hydrates it via
    // GET /stories/:id/commentary after the feed lands. Returning
    // nulls here (rather than omitting the keys) makes the "not yet
    // loaded" state explicit on the wire and lets TypeScript consumers
    // treat the field as `string | null` rather than `string | undefined`.
    // The `commentary_source` field is the null-mirror of
    // CommentaryResult.source — populated only by the dedicated endpoint.
    commentary: null,
    commentary_source: null,
    source_url: row.sourceUrl,
    source_name: row.sourceName,
    published_at: row.publishedAt,
    created_at: row.createdAt,
    author: row.authorId
      ? { id: row.authorId, name: row.authorName, bio: row.authorBio }
      : null,
    is_saved: Boolean(row.isSaved),
    save_count: Number(row.saveCount ?? 0),
    comment_count: Number(row.commentCount ?? 0),
  };
}

function isSavedExpr(userId: string): ReturnType<typeof sql<boolean>> {
  return sql<boolean>`EXISTS (SELECT 1 FROM user_saves us WHERE us.story_id = ${stories.id} AND us.user_id = ${userId})`;
}

function saveCountExpr(): ReturnType<typeof sql<number>> {
  return sql<number>`(SELECT COUNT(*)::int FROM user_saves us WHERE us.story_id = ${stories.id})`;
}

function commentCountExpr(): ReturnType<typeof sql<number>> {
  return sql<number>`(SELECT COUNT(*)::int FROM comments c WHERE c.story_id = ${stories.id} AND c.deleted_at IS NULL)`;
}

const baseStoryColumns = {
  id: stories.id,
  sector: stories.sector,
  headline: stories.headline,
  context: stories.context,
  whyItMatters: stories.whyItMatters,
  whyItMattersTemplate: stories.whyItMattersTemplate,
  sourceUrl: stories.sourceUrl,
  sourceName: stories.sourceName,
  publishedAt: stories.publishedAt,
  createdAt: stories.createdAt,
  authorId: writers.id,
  authorName: writers.name,
  authorBio: writers.bio,
};

export async function getFeed(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { sectors: requestedSectors, limit, offset } = feedQuerySchema.parse(req.query);

    const [profile] = await db
      .select({ sectors: userProfiles.sectors, role: userProfiles.role })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .limit(1);

    const profileSectors = profile?.sectors ?? [];
    const sectorsFilter = requestedSectors.length > 0 ? requestedSectors : profileSectors;

    if (sectorsFilter.length === 0) {
      res.json({ data: { stories: [], total: 0, has_more: false, limit, offset } });
      return;
    }

    const rows = (await db
      .select({
        ...baseStoryColumns,
        isSaved: isSavedExpr(userId),
        saveCount: saveCountExpr(),
        commentCount: commentCountExpr(),
      })
      .from(stories)
      .leftJoin(writers, eq(writers.id, stories.authorId))
      .where(inArray(stories.sector, sectorsFilter))
      .orderBy(desc(sql`COALESCE(${stories.publishedAt}, ${stories.createdAt})`))
      .limit(limit)
      .offset(offset)) as StoryRow[];

    const [countRow] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(stories)
      .where(inArray(stories.sector, sectorsFilter));
    const total = Number(countRow?.count ?? 0);

    const shaped = rows.map((row) => shapeStory(row, profile?.role ?? null));

    res.json({
      data: {
        stories: shaped,
        total,
        has_more: offset + rows.length < total,
        limit,
        offset,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getStoryById(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = idParamSchema.parse(req.params);

    const [profile] = await db
      .select({ role: userProfiles.role })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .limit(1);

    const [row] = (await db
      .select({
        ...baseStoryColumns,
        isSaved: isSavedExpr(userId),
        saveCount: saveCountExpr(),
        commentCount: commentCountExpr(),
      })
      .from(stories)
      .leftJoin(writers, eq(writers.id, stories.authorId))
      .where(eq(stories.id, id))
      .limit(1)) as StoryRow[];

    if (!row) {
      throw new AppError("STORY_NOT_FOUND", "Story not found", 404);
    }

    res.json({ data: { story: shapeStory(row, profile?.role ?? null) } });
  } catch (error) {
    next(error);
  }
}

async function countSaves(storyId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(userSaves)
    .where(eq(userSaves.storyId, storyId));
  return Number(row?.count ?? 0);
}

async function ensureStoryExists(storyId: string): Promise<void> {
  const [row] = await db
    .select({ id: stories.id })
    .from(stories)
    .where(eq(stories.id, storyId))
    .limit(1);
  if (!row) {
    throw new AppError("STORY_NOT_FOUND", "Story not found", 404);
  }
}

export async function saveStory(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = idParamSchema.parse(req.params);
    await ensureStoryExists(id);

    await db
      .insert(userSaves)
      .values({ userId, storyId: id })
      .onConflictDoNothing({
        target: [userSaves.userId, userSaves.storyId],
      });

    const saveCount = await countSaves(id);
    res.json({ data: { saved: true, save_count: saveCount } });
  } catch (error) {
    next(error);
  }
}

export async function unsaveStory(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = idParamSchema.parse(req.params);

    await db
      .delete(userSaves)
      .where(and(eq(userSaves.userId, userId), eq(userSaves.storyId, id)));

    const saveCount = await countSaves(id);
    res.json({ data: { saved: false, save_count: saveCount } });
  } catch (error) {
    next(error);
  }
}

const savesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

interface SavedStoryRow extends StoryRow {
  savedAt: Date;
}

export async function listMySaves(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { limit, offset } = savesQuerySchema.parse(req.query);

    const [profile] = await db
      .select({ role: userProfiles.role })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .limit(1);

    const rows = (await db
      .select({
        ...baseStoryColumns,
        isSaved: sql<boolean>`TRUE`,
        saveCount: saveCountExpr(),
        commentCount: commentCountExpr(),
        savedAt: userSaves.savedAt,
      })
      .from(userSaves)
      .innerJoin(stories, eq(stories.id, userSaves.storyId))
      .leftJoin(writers, eq(writers.id, stories.authorId))
      .where(eq(userSaves.userId, userId))
      .orderBy(desc(userSaves.savedAt))
      .limit(limit)
      .offset(offset)) as SavedStoryRow[];

    const [countRow] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(userSaves)
      .where(eq(userSaves.userId, userId));
    const total = Number(countRow?.count ?? 0);

    const shaped = rows.map((row) => ({
      ...shapeStory(row, profile?.role ?? null),
      saved_at: row.savedAt,
    }));

    res.json({
      data: {
        stories: shaped,
        total,
        has_more: offset + rows.length < total,
        limit,
        offset,
      },
    });
  } catch (error) {
    next(error);
  }
}

const MAX_QUERY_LENGTH = 200;

const searchQuerySchema = z.object({
  q: z.string().trim().min(2).max(MAX_QUERY_LENGTH),
  sector: z.string().trim().min(1).optional(),
  from_date: z
    .string()
    .datetime({ offset: true })
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
    .optional(),
  to_date: z
    .string()
    .datetime({ offset: true })
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
    .optional(),
  sort: z.enum(["relevance", "newest", "most_saved"]).default("relevance"),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

function parseBoundaryDate(value: string, end: boolean): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T${end ? "23:59:59.999" : "00:00:00.000"}Z`);
  }
  return new Date(value);
}

export async function searchStories(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const parsed = searchQuerySchema.parse(req.query);

    const fromDate = parsed.from_date
      ? parseBoundaryDate(parsed.from_date, false)
      : undefined;
    const toDate = parsed.to_date
      ? parseBoundaryDate(parsed.to_date, true)
      : undefined;

    if (fromDate && Number.isNaN(fromDate.getTime())) {
      throw new AppError("INVALID_INPUT", "Invalid from_date", 400);
    }
    if (toDate && Number.isNaN(toDate.getTime())) {
      throw new AppError("INVALID_INPUT", "Invalid to_date", 400);
    }

    const [profile] = await db
      .select({ role: userProfiles.role })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .limit(1);

    const tsVector = sql`to_tsvector('english', coalesce(${stories.headline}, '') || ' ' || coalesce(${stories.context}, ''))`;
    const tsQuery = sql`websearch_to_tsquery('english', ${parsed.q})`;
    const rankExpr = sql<number>`ts_rank(${tsVector}, ${tsQuery})`;

    const clauses: SQL[] = [sql`${tsVector} @@ ${tsQuery}`];
    if (parsed.sector) clauses.push(eq(stories.sector, parsed.sector));
    if (fromDate) clauses.push(gte(stories.publishedAt, fromDate));
    if (toDate) clauses.push(lte(stories.publishedAt, toDate));
    const whereCondition = clauses.length === 1 ? clauses[0] : and(...clauses);

    const orderBy =
      parsed.sort === "newest"
        ? desc(sql`COALESCE(${stories.publishedAt}, ${stories.createdAt})`)
        : parsed.sort === "most_saved"
          ? desc(saveCountExpr())
          : desc(rankExpr);

    const rows = (await db
      .select({
        ...baseStoryColumns,
        isSaved: isSavedExpr(userId),
        saveCount: saveCountExpr(),
        commentCount: commentCountExpr(),
        rank: rankExpr,
      })
      .from(stories)
      .leftJoin(writers, eq(writers.id, stories.authorId))
      .where(whereCondition)
      .orderBy(orderBy)
      .limit(parsed.limit)
      .offset(parsed.offset)) as Array<StoryRow & { rank: number }>;

    const [countRow] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(stories)
      .where(whereCondition);
    const total = Number(countRow?.count ?? 0);

    const shaped = rows.map((row) => ({
      ...shapeStory(row, profile?.role ?? null),
      rank: Number(row.rank ?? 0),
    }));

    res.json({
      data: {
        stories: shaped,
        total,
        has_more: parsed.offset + rows.length < total,
        limit: parsed.limit,
        offset: parsed.offset,
        query: parsed.q,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getRelatedStories(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = idParamSchema.parse(req.params);

    const [current] = await db
      .select({ id: stories.id, sector: stories.sector })
      .from(stories)
      .where(eq(stories.id, id))
      .limit(1);
    if (!current) {
      throw new AppError("STORY_NOT_FOUND", "Story not found", 404);
    }

    const [profile] = await db
      .select({ role: userProfiles.role })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .limit(1);

    const rows = (await db
      .select({
        ...baseStoryColumns,
        isSaved: isSavedExpr(userId),
        saveCount: saveCountExpr(),
        commentCount: commentCountExpr(),
      })
      .from(stories)
      .leftJoin(writers, eq(writers.id, stories.authorId))
      .where(and(eq(stories.sector, current.sector), ne(stories.id, current.id)))
      .orderBy(desc(sql`COALESCE(${stories.publishedAt}, ${stories.createdAt})`))
      .limit(RELATED_LIMIT)) as StoryRow[];

    const shaped = rows.map((row) => shapeStory(row, profile?.role ?? null));
    res.json({ data: { stories: shaped } });
  } catch (error) {
    next(error);
  }
}
