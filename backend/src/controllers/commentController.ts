import type { NextFunction, Request, Response } from "express";
import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { comments, events, stories, users } from "../db/schema";
import { AppError } from "../middleware/errorHandler";

const MAX_CONTENT = 2000;
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

const createCommentSchema = z.object({
  content: z.string().trim().min(1).max(MAX_CONTENT),
  parent_comment_id: z.string().uuid().optional().nullable(),
});

const updateCommentSchema = z.object({
  content: z.string().trim().min(1).max(MAX_CONTENT),
});

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  offset: z.coerce.number().int().min(0).default(0),
});

const storyIdParamSchema = z.object({ story_id: z.string().uuid() });
const idParamSchema = z.object({ id: z.string().uuid() });

function requireUserId(req: Request): string {
  if (!req.user) {
    throw new AppError("UNAUTHORIZED", "Not authenticated", 401);
  }
  return req.user.userId;
}

interface CommentRow {
  id: string;
  // Phase 12e.7b — exactly one of storyId / eventId is non-null per
  // row (DB-level CHECK in migration 0023). Type reflects reality so
  // downstream code branches explicitly rather than coercing.
  storyId: string | null;
  eventId: string | null;
  userId: string;
  parentCommentId: string | null;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  authorName: string | null;
  authorEmail: string;
  authorProfilePictureUrl: string | null;
}

function shapeComment(
  row: CommentRow,
  replyCount?: number,
): Record<string, unknown> {
  const isDeleted = Boolean(row.deletedAt);
  return {
    id: row.id,
    // Phase 12e.7b — both fields surface on the wire, one always null.
    // Clients can tell story-targeted from event-targeted comments by
    // checking which is set without a separate type discriminator.
    story_id: row.storyId,
    event_id: row.eventId,
    parent_comment_id: row.parentCommentId,
    content: isDeleted ? "[deleted]" : row.content,
    is_deleted: isDeleted,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    author: {
      id: row.userId,
      name: row.authorName,
      email: row.authorEmail,
      profile_picture_url: row.authorProfilePictureUrl,
    },
    reply_count: replyCount ?? 0,
  };
}

const baseCommentColumns = {
  id: comments.id,
  storyId: comments.storyId,
  eventId: comments.eventId,
  userId: comments.userId,
  parentCommentId: comments.parentCommentId,
  content: comments.content,
  createdAt: comments.createdAt,
  updatedAt: comments.updatedAt,
  deletedAt: comments.deletedAt,
  authorName: users.name,
  authorEmail: users.email,
  authorProfilePictureUrl: users.profilePictureUrl,
};

// Phase 12e.7b — resolve a target id to either a story or an event row,
// returning the discriminator so callers can dispatch the comment write
// to the matching FK column. 404 if neither table has the id.
async function ensureTargetExists(targetId: string): Promise<"story" | "event"> {
  const [storyRow] = await db
    .select({ id: stories.id })
    .from(stories)
    .where(eq(stories.id, targetId))
    .limit(1);
  if (storyRow) return "story";

  const [eventRow] = await db
    .select({ id: events.id })
    .from(events)
    .where(eq(events.id, targetId))
    .limit(1);
  if (eventRow) return "event";

  throw new AppError("STORY_NOT_FOUND", "Story not found", 404);
}

async function replyCountExpr(parentId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(comments)
    .where(
      and(eq(comments.parentCommentId, parentId), isNull(comments.deletedAt)),
    );
  return Number(row?.count ?? 0);
}

export async function createComment(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { story_id: storyId } = storyIdParamSchema.parse(req.params);
    const { content, parent_comment_id: parentCommentId } =
      createCommentSchema.parse(req.body);

    const targetType = await ensureTargetExists(storyId);

    if (parentCommentId) {
      const [parent] = await db
        .select({
          id: comments.id,
          storyId: comments.storyId,
          eventId: comments.eventId,
        })
        .from(comments)
        .where(eq(comments.id, parentCommentId))
        .limit(1);
      if (!parent) {
        throw new AppError("PARENT_NOT_FOUND", "Parent comment not found", 404);
      }
      // Whichever FK the parent carries must match the requested target.
      // The CHECK constraint guarantees exactly one is non-null per row.
      const parentTarget = parent.storyId ?? parent.eventId;
      if (parentTarget !== storyId) {
        throw new AppError(
          "PARENT_MISMATCH",
          "Parent comment belongs to a different story",
          400,
        );
      }
    }

    const [inserted] = await db
      .insert(comments)
      .values({
        storyId: targetType === "story" ? storyId : null,
        eventId: targetType === "event" ? storyId : null,
        userId,
        content,
        parentCommentId: parentCommentId ?? null,
      })
      .returning();

    const [row] = (await db
      .select(baseCommentColumns)
      .from(comments)
      .innerJoin(users, eq(users.id, comments.userId))
      .where(eq(comments.id, inserted.id))
      .limit(1)) as CommentRow[];

    res.status(201).json({ data: { comment: shapeComment(row, 0) } });
  } catch (error) {
    next(error);
  }
}

export async function listStoryComments(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    requireUserId(req);
    const { story_id: storyId } = storyIdParamSchema.parse(req.params);
    const { limit, offset } = listQuerySchema.parse(req.query);

    await ensureTargetExists(storyId);

    // Phase 12e.7b — match either FK column. The CHECK constraint
    // guarantees exactly one is non-null per row, so the OR doesn't
    // double-count.
    const targetFilter = or(
      eq(comments.storyId, storyId),
      eq(comments.eventId, storyId),
    )!;

    const rows = (await db
      .select(baseCommentColumns)
      .from(comments)
      .innerJoin(users, eq(users.id, comments.userId))
      .where(and(targetFilter, isNull(comments.parentCommentId)))
      .orderBy(desc(comments.createdAt))
      .limit(limit)
      .offset(offset)) as CommentRow[];

    const [countRow] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(comments)
      .where(and(targetFilter, isNull(comments.parentCommentId)));
    const total = Number(countRow?.count ?? 0);

    const shaped = await Promise.all(
      rows.map(async (row) => shapeComment(row, await replyCountExpr(row.id))),
    );

    res.json({
      data: {
        comments: shaped,
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

export async function listReplies(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    requireUserId(req);
    const { id } = idParamSchema.parse(req.params);

    const [parent] = await db
      .select({ id: comments.id })
      .from(comments)
      .where(eq(comments.id, id))
      .limit(1);
    if (!parent) {
      throw new AppError("COMMENT_NOT_FOUND", "Comment not found", 404);
    }

    const rows = (await db
      .select(baseCommentColumns)
      .from(comments)
      .innerJoin(users, eq(users.id, comments.userId))
      .where(eq(comments.parentCommentId, id))
      .orderBy(asc(comments.createdAt))) as CommentRow[];

    const shaped = rows.map((row) => shapeComment(row, 0));
    res.json({ data: { comments: shaped } });
  } catch (error) {
    next(error);
  }
}

export async function deleteComment(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = idParamSchema.parse(req.params);

    const [existing] = await db
      .select({
        id: comments.id,
        userId: comments.userId,
        deletedAt: comments.deletedAt,
      })
      .from(comments)
      .where(eq(comments.id, id))
      .limit(1);
    if (!existing) {
      throw new AppError("COMMENT_NOT_FOUND", "Comment not found", 404);
    }
    if (existing.userId !== userId) {
      throw new AppError("FORBIDDEN", "You cannot delete this comment", 403);
    }
    if (existing.deletedAt) {
      res.json({ data: { id } });
      return;
    }

    await db
      .update(comments)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(comments.id, id));

    res.json({ data: { id } });
  } catch (error) {
    next(error);
  }
}

export async function updateComment(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = idParamSchema.parse(req.params);
    const { content } = updateCommentSchema.parse(req.body);

    const [existing] = await db
      .select({
        id: comments.id,
        userId: comments.userId,
        deletedAt: comments.deletedAt,
      })
      .from(comments)
      .where(eq(comments.id, id))
      .limit(1);
    if (!existing) {
      throw new AppError("COMMENT_NOT_FOUND", "Comment not found", 404);
    }
    if (existing.userId !== userId) {
      throw new AppError("FORBIDDEN", "You cannot edit this comment", 403);
    }
    if (existing.deletedAt) {
      throw new AppError("COMMENT_DELETED", "Comment has been deleted", 410);
    }

    await db
      .update(comments)
      .set({ content, updatedAt: new Date() })
      .where(eq(comments.id, id));

    const [row] = (await db
      .select(baseCommentColumns)
      .from(comments)
      .innerJoin(users, eq(users.id, comments.userId))
      .where(eq(comments.id, id))
      .limit(1)) as CommentRow[];

    res.json({ data: { comment: shapeComment(row) } });
  } catch (error) {
    next(error);
  }
}
