import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

// ---------- Enums ----------

export const userStatusEnum = pgEnum("user_status", ["active", "inactive", "deleted"]);
export const emailFrequencyEnum = pgEnum("email_frequency", ["daily", "weekly", "never"]);
export const commentVisibilityEnum = pgEnum("comment_visibility", ["public", "team", "private"]);
export const teamMemberRoleEnum = pgEnum("team_member_role", ["admin", "member", "viewer"]);
export const emailQueueStatusEnum = pgEnum("email_queue_status", ["pending", "sent", "failed"]);
export const apiKeyTierEnum = pgEnum("api_key_tier", ["starter", "pro", "enterprise"]);

// ---------- Users ----------

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }),
  name: varchar("name", { length: 255 }),
  profilePictureUrl: text("profile_picture_url"),
  status: userStatusEnum("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

// ---------- User profiles ----------

export const userProfiles = pgTable("user_profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  sectors: jsonb("sectors").$type<string[]>(),
  role: varchar("role", { length: 50 }),
  goals: jsonb("goals").$type<string[]>(),
  emailFrequency: emailFrequencyEnum("email_frequency").notNull().default("weekly"),
  emailUnsubscribed: boolean("email_unsubscribed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------- Writers ----------

export const writers = pgTable("writers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).unique(),
  bio: text("bio"),
  twitterHandle: varchar("twitter_handle", { length: 100 }),
  sectors: jsonb("sectors").$type<string[]>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------- Stories ----------

export const stories = pgTable(
  "stories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sector: varchar("sector", { length: 50 }).notNull(),
    headline: varchar("headline", { length: 255 }).notNull(),
    context: text("context").notNull(),
    whyItMatters: text("why_it_matters").notNull(),
    whyItMattersTemplate: text("why_it_matters_template"),
    sourceUrl: text("source_url").notNull(),
    sourceName: varchar("source_name", { length: 255 }),
    authorId: uuid("author_id").references(() => writers.id, { onDelete: "set null" }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    sectorPublishedIdx: index("stories_sector_published_at_idx").on(t.sector, t.publishedAt),
    createdAtIdx: index("stories_created_at_idx").on(t.createdAt),
  }),
);

// ---------- Story aggregates ----------

// Precomputed per-sector weekly rollups. Populated by the aggregation job
// (`aggregationJob.ts`); read by `/api/v2/trends/:sector`. `save_count` is
// reserved for future engagement-weighted aggregation and stays 0 in v1 —
// the column exists so adding a `user_saves` JOIN later doesn't require a
// migration or API contract change. Upsert target is (sector, period).
export const storyAggregates = pgTable(
  "story_aggregates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sector: varchar("sector", { length: 50 }).notNull(),
    // ISO week string, e.g. "2026-W16". 8-char max in practice but we allow
    // 10 to tolerate hypothetical 5-digit years and separator variants.
    period: varchar("period", { length: 10 }).notNull(),
    storyCount: integer("story_count").notNull().default(0),
    saveCount: integer("save_count").notNull().default(0),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Unique (sector, period) is the upsert target AND the query index —
    // Postgres creates a btree index for every UNIQUE constraint, so a
    // separate non-unique (sector, period) index would be redundant.
    sectorPeriodUnique: unique("story_aggregates_sector_period_unique").on(t.sector, t.period),
    computedAtIdx: index("story_aggregates_computed_at_idx").on(t.computedAt),
  }),
);

// ---------- User saves ----------

export const userSaves = pgTable(
  "user_saves",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    storyId: uuid("story_id")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    savedAt: timestamp("saved_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userStoryUnique: unique("user_saves_user_story_unique").on(t.userId, t.storyId),
  }),
);

// ---------- Teams ----------

export interface TeamSettings {
  sectors: string[];
}

export const teams = pgTable(
  "teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 255 }).notNull(),
    description: varchar("description", { length: 500 }),
    slug: varchar("slug", { length: 100 }).notNull().unique(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    settings: jsonb("settings")
      .$type<TeamSettings>()
      .notNull()
      .default({ sectors: [] }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    slugIdx: index("teams_slug_idx").on(t.slug),
  }),
);

export const teamMembers = pgTable(
  "team_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: teamMemberRoleEnum("role").notNull().default("member"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    teamUserUnique: unique("team_members_team_user_unique").on(t.teamId, t.userId),
    teamIdx: index("team_members_team_idx").on(t.teamId),
    userIdx: index("team_members_user_idx").on(t.userId),
  }),
);

export const teamInvites = pgTable(
  "team_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    email: varchar("email", { length: 255 }).notNull(),
    role: teamMemberRoleEnum("role").notNull().default("member"),
    token: text("token").notNull().unique(),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    teamEmailIdx: index("team_invites_team_email_idx").on(t.teamId, t.email),
    tokenIdx: index("team_invites_token_idx").on(t.token),
  }),
);

// ---------- Comments ----------

export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storyId: uuid("story_id")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    parentCommentId: uuid("parent_comment_id").references(
      (): AnyPgColumn => comments.id,
      { onDelete: "cascade" },
    ),
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "set null" }),
    visibility: commentVisibilityEnum("visibility").notNull().default("public"),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    storyIdx: index("comments_story_idx").on(t.storyId),
    teamStoryIdx: index("comments_team_story_idx").on(t.teamId, t.storyId),
  }),
);

// ---------- Email queue ----------

export const emailQueue = pgTable("email_queue", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  emailAddress: varchar("email_address", { length: 255 }).notNull(),
  subject: varchar("subject", { length: 255 }),
  htmlContent: text("html_content"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  status: emailQueueStatusEnum("status").notNull().default("pending"),
  retryCount: integer("retry_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------- Learning paths ----------

export const learningPaths = pgTable("learning_paths", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  sector: varchar("sector", { length: 50 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const learningPathStories = pgTable(
  "learning_path_stories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pathId: uuid("path_id")
      .notNull()
      .references(() => learningPaths.id, { onDelete: "cascade" }),
    storyId: uuid("story_id")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    orderIndex: integer("order_index"),
    moduleNumber: integer("module_number"),
  },
  (t) => ({
    pathStoryUnique: unique("learning_path_stories_path_story_unique").on(t.pathId, t.storyId),
  }),
);

export const userLearningProgress = pgTable(
  "user_learning_progress",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    pathId: uuid("path_id")
      .notNull()
      .references(() => learningPaths.id, { onDelete: "cascade" }),
    completedStoryIds: jsonb("completed_story_ids").$type<string[]>(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => ({
    userPathUnique: unique("user_learning_progress_user_path_unique").on(t.userId, t.pathId),
  }),
);

// ---------- API keys ----------

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    label: varchar("label", { length: 100 }).notNull(),
    keyPrefix: varchar("key_prefix", { length: 16 }).notNull(),
    keyHash: varchar("key_hash", { length: 64 }).notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => ({
    userIdIdx: index("api_keys_user_id_idx").on(t.userId),
    userLabelActiveUnique: uniqueIndex("api_keys_user_label_active_unique")
      .on(t.userId, t.label)
      .where(sql`${t.revokedAt} IS NULL`),
  }),
);

// ---------- Exported row types ----------

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type UserProfile = typeof userProfiles.$inferSelect;
export type NewUserProfile = typeof userProfiles.$inferInsert;
export type Writer = typeof writers.$inferSelect;
export type NewWriter = typeof writers.$inferInsert;
export type Story = typeof stories.$inferSelect;
export type NewStory = typeof stories.$inferInsert;
export type StoryAggregate = typeof storyAggregates.$inferSelect;
export type NewStoryAggregate = typeof storyAggregates.$inferInsert;
export type UserSave = typeof userSaves.$inferSelect;
export type Team = typeof teams.$inferSelect;
export type NewTeam = typeof teams.$inferInsert;
export type TeamMember = typeof teamMembers.$inferSelect;
export type NewTeamMember = typeof teamMembers.$inferInsert;
export type TeamInvite = typeof teamInvites.$inferSelect;
export type NewTeamInvite = typeof teamInvites.$inferInsert;
export type Comment = typeof comments.$inferSelect;
export type NewComment = typeof comments.$inferInsert;
export type EmailQueueItem = typeof emailQueue.$inferSelect;
export type LearningPath = typeof learningPaths.$inferSelect;
export type LearningPathStory = typeof learningPathStories.$inferSelect;
export type UserLearningProgress = typeof userLearningProgress.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
