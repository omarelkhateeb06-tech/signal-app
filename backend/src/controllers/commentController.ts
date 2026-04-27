import type { NextFunction, Request, Response } from "express";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { comments, stories, users } from "../db/schema";
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
  storyId: string;
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
    story_id: row.storyId,
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

    await ensureStoryExists(storyId);

    if (parentCommentId) {
      const [parent] = await db
        .select({ id: comments.id, storyId: comments.storyId })
        .from(comments)
        .where(eq(comments.id, parentCommentId))
        .limit(1);
      if (!parent) {
        throw new AppError("PARENT_NOT_FOUND", "Parent comment not found", 404);
      }
      if (parent.storyId !== storyId) {
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
        storyId,
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

    await ensureStoryExists(storyId);

    const rows = (await db
      .select(baseCommentColumns)
      .from(comments)
      .innerJoin(users, eq(users.id, comments.userId))
      .where(
        and(eq(comments.storyId, storyId), isNull(comments.parentCommentId)),
      )
      .orderBy(desc(comments.createdAt))
      .limit(limit)
      .offset(offset)) as CommentRow[];

    const [countRow] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(comments)
      .where(
        and(eq(comments.storyId, storyId), isNull(comments.parentCommentId)),
      );
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
