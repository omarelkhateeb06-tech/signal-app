import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "./index";
import {
  comments,
  stories,
  userSaves,
  users,
  writers,
  type Comment,
  type Story,
  type User,
  type Writer,
} from "./schema";

// ---------- Users ----------

export async function getUserById(id: string): Promise<User | null> {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);
  return rows[0] ?? null;
}

// ---------- Writers ----------

export async function getWriterById(id: string): Promise<Writer | null> {
  const rows = await db.select().from(writers).where(eq(writers.id, id)).limit(1);
  return rows[0] ?? null;
}

// ---------- Stories ----------

export interface StoryFeedOptions {
  sector?: string;
  limit?: number;
  offset?: number;
}

export async function getStories(options: StoryFeedOptions = {}): Promise<Story[]> {
  const { sector, limit = 20, offset = 0 } = options;
  const where = sector ? eq(stories.sector, sector) : undefined;
  const query = db
    .select()
    .from(stories)
    .orderBy(desc(stories.publishedAt), desc(stories.createdAt))
    .limit(limit)
    .offset(offset);
  return where ? await query.where(where) : await query;
}

export async function getStoryById(id: string): Promise<Story | null> {
  const rows = await db.select().from(stories).where(eq(stories.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function countStories(sector?: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(stories)
    .where(sector ? eq(stories.sector, sector) : undefined);
  return rows[0]?.count ?? 0;
}

// ---------- Saves ----------

export async function getSavedStoriesForUser(
  userId: string,
  limit = 20,
  offset = 0,
): Promise<Story[]> {
  const rows = await db
    .select({ story: stories })
    .from(userSaves)
    .innerJoin(stories, eq(stories.id, userSaves.storyId))
    .where(eq(userSaves.userId, userId))
    .orderBy(desc(userSaves.savedAt))
    .limit(limit)
    .offset(offset);
  return rows.map((r) => r.story);
}

export async function saveStoryForUser(userId: string, storyId: string): Promise<void> {
  await db
    .insert(userSaves)
    .values({ userId, storyId })
    .onConflictDoNothing({ target: [userSaves.userId, userSaves.storyId] });
}

export async function unsaveStoryForUser(userId: string, storyId: string): Promise<void> {
  await db
    .delete(userSaves)
    .where(and(eq(userSaves.userId, userId), eq(userSaves.storyId, storyId)));
}

// ---------- Comments ----------

export async function getCommentsForStory(storyId: string): Promise<Comment[]> {
  return await db
    .select()
    .from(comments)
    .where(and(eq(comments.storyId, storyId), sql`${comments.deletedAt} is null`))
    .orderBy(comments.createdAt);
}
