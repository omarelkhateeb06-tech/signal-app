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
  uuid,
  varchar,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

// ---------- Enums ----------

export const userStatusEnum = pgEnum("user_status", ["active", "inactive", "deleted"]);
export const emailFrequencyEnum = pgEnum("email_frequency", ["daily", "weekly", "never"]);
export const commentVisibilityEnum = pgEnum("comment_visibility", ["public", "team", "private"]);
export const teamTierEnum = pgEnum("team_tier", ["small", "medium", "large", "custom"]);
export const teamMemberRoleEnum = pgEnum("team_member_role", ["admin", "member"]);
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

export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  adminUserId: uuid("admin_user_id").references(() => users.id, { onDelete: "set null" }),
  companyName: varchar("company_name", { length: 255 }),
  tier: teamTierEnum("tier"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

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
  },
  (t) => ({
    teamUserUnique: unique("team_members_team_user_unique").on(t.teamId, t.userId),
  }),
);

// ---------- Comments ----------

export const comments = pgTable("comments", {
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
});

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

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id").notNull(),
  keyHash: varchar("key_hash", { length: 255 }).notNull().unique(),
  tier: apiKeyTierEnum("tier"),
  rateLimitDaily: integer("rate_limit_daily"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
});

// ---------- Exported row types ----------

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type UserProfile = typeof userProfiles.$inferSelect;
export type NewUserProfile = typeof userProfiles.$inferInsert;
export type Writer = typeof writers.$inferSelect;
export type NewWriter = typeof writers.$inferInsert;
export type Story = typeof stories.$inferSelect;
export type NewStory = typeof stories.$inferInsert;
export type UserSave = typeof userSaves.$inferSelect;
export type Team = typeof teams.$inferSelect;
export type TeamMember = typeof teamMembers.$inferSelect;
export type Comment = typeof comments.$inferSelect;
export type NewComment = typeof comments.$inferInsert;
export type EmailQueueItem = typeof emailQueue.$inferSelect;
export type LearningPath = typeof learningPaths.$inferSelect;
export type LearningPathStory = typeof learningPathStories.$inferSelect;
export type UserLearningProgress = typeof userLearningProgress.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
