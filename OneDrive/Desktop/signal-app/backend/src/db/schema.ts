import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
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

// Phase 12b: `sectors` and `goals` migrated jsonb → text[] (native
// Postgres arrays). The Phase 12a-and-earlier profile shape stays:
// `email_frequency` + `email_unsubscribed` are still driven by the
// unsubscribe flow. The five new columns — seniority, depth_preference,
// digest_preference, timezone, completed_at — are nullable and only
// set by the onboarding completion path. `completed_at IS NOT NULL`
// is the authoritative "is this user onboarded" predicate; the mere
// presence of a user_profiles row (e.g. from unsubscribe) does NOT
// count as onboarded.
//
// depth_preference / digest_preference are backed by CHECK constraints
// at the DB boundary, not pgEnums (see migration 0008). The allowed
// value sets are re-declared here as const tuples so the controller's
// Zod schemas can reference them.
export const DEPTH_PREFERENCES = ["accessible", "standard", "technical"] as const;
export type DepthPreference = (typeof DEPTH_PREFERENCES)[number];
export const DIGEST_PREFERENCES = ["morning", "evening", "none"] as const;
export type DigestPreference = (typeof DIGEST_PREFERENCES)[number];

// Phase 12c added `domain` (free-text from a curated list, selected on
// Screen 2) and `profile_version` (monotonic int, bumps on any post-
// onboarding mutation to commentary-affecting fields). Both are on
// user_profiles rather than users — every onboarding-captured field
// already lives here, and keeping them co-located avoids a cross-
// table JOIN on every commentary lookup. `domain` is nullable at the
// DB layer (same pattern as seniority/depth_preference — pre-
// onboarding rows from the unsubscribe flow need to exist without
// it) plus a CHECK rejecting empty strings. `profile_version` is
// NOT NULL DEFAULT 1; the default fills existing rows during the
// ALTER and the completion path leaves it at 1.
export const userProfiles = pgTable("user_profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  sectors: text("sectors").array(),
  role: varchar("role", { length: 50 }),
  domain: text("domain"),
  seniority: text("seniority"),
  depthPreference: text("depth_preference").$type<DepthPreference>(),
  goals: text("goals").array(),
  digestPreference: text("digest_preference").$type<DigestPreference>(),
  timezone: text("timezone"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  profileVersion: integer("profile_version").notNull().default(1),
  emailFrequency: emailFrequencyEnum("email_frequency").notNull().default("weekly"),
  emailUnsubscribed: boolean("email_unsubscribed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------- User topic interests ----------
//
// Per-sector topic selections captured on Screen 5 of onboarding.
// Normalized out of user_profiles so we can filter on a single topic
// without array-containment queries. Composite PK (user_id, sector,
// topic) makes re-inserts idempotent without an extra unique index.

export const userTopicInterests = pgTable(
  "user_topic_interests",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sector: text("sector").notNull(),
    topic: text("topic").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ name: "user_topic_interests_pk", columns: [t.userId, t.sector, t.topic] }),
    userIdx: index("user_topic_interests_user_idx").on(t.userId),
  }),
);

// ---------- Onboarding events ----------
//
// Append-only telemetry for the onboarding funnel. Written from the
// batched `/onboarding/events` endpoint and the completion path.
// `metadata` is jsonb so event-specific payloads can evolve without
// schema churn.

export const onboardingEvents = pgTable(
  "onboarding_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    screenNumber: integer("screen_number"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userCreatedIdx: index("onboarding_events_user_created_idx").on(t.userId, t.createdAt),
    typeIdx: index("onboarding_events_type_idx").on(t.eventType),
  }),
);

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

// Depth-variant commentary payload stored JSON-stringified in
// `why_it_matters_template` (TEXT, not JSONB — historical from migration
// 0000). Shape is enforced at the application layer (Zod in seedStories
// and the v2 controller), not by a CHECK constraint. Phase 12a replaced
// the earlier sector-variant shape ({ai, finance, semiconductors}) with
// depth variants; the column name intentionally did not change so
// existing JOINs / analytics queries kept working.
export const DEPTH_LEVELS = ["accessible", "standard", "technical"] as const;
export type DepthLevel = (typeof DEPTH_LEVELS)[number];
export type WhyItMattersTemplate = Record<DepthLevel, string>;

export const stories = pgTable(
  "stories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sector: varchar("sector", { length: 50 }).notNull(),
    headline: varchar("headline", { length: 255 }).notNull(),
    context: text("context").notNull(),
    whyItMatters: text("why_it_matters").notNull(),
    // Stored as TEXT containing a JSON-encoded `WhyItMattersTemplate`. Use
    // `parseWhyItMattersTemplate()` from `src/utils/depthVariants.ts` at
    // read time; never consume the raw string in controllers.
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

// ---------- Commentary cache ----------
//
// Phase 12c. Append-only cache for per-user, per-story Haiku-generated
// commentary. Key is (user_id, story_id, depth, profile_version) —
// changing depth or any commentary-affecting profile field bumps
// profile_version and causes subsequent lookups to miss, triggering
// regeneration on next view. Failed Haiku calls fall back to the
// tiered template and are deliberately NOT cached; only successful
// model output lands here. GC of orphaned rows is a stub in 12c and
// gets scheduled in 12c.1.

export const commentaryCache = pgTable(
  "commentary_cache",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    storyId: uuid("story_id")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    depth: text("depth").$type<DepthLevel>().notNull(),
    profileVersion: integer("profile_version").notNull(),
    commentary: text("commentary").notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    keyUnique: unique("commentary_cache_key_unique").on(
      t.userId,
      t.storyId,
      t.depth,
      t.profileVersion,
    ),
    userIdx: index("commentary_cache_user_idx").on(t.userId),
    userStoryIdx: index("commentary_cache_user_story_idx").on(t.userId, t.storyId),
  }),
);

// ---------- Exported row types ----------

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type UserProfile = typeof userProfiles.$inferSelect;
export type NewUserProfile = typeof userProfiles.$inferInsert;
export type UserTopicInterest = typeof userTopicInterests.$inferSelect;
export type NewUserTopicInterest = typeof userTopicInterests.$inferInsert;
export type OnboardingEvent = typeof onboardingEvents.$inferSelect;
export type NewOnboardingEvent = typeof onboardingEvents.$inferInsert;
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
export type CommentaryCacheRow = typeof commentaryCache.$inferSelect;
export type NewCommentaryCacheRow = typeof commentaryCache.$inferInsert;
