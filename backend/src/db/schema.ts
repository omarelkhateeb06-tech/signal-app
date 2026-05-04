import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
  vector,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

// ---------- Custom column types ----------

// Phase 12e.6a — `events.embedding` is now `vector(1536)` (OpenAI
// text-embedding-3-small). The bytea placeholder shipped in 12e.1 was
// replaced by migration 0021; no remaining columns use bytea, so the
// customType helper was removed in this session.

// ---------- Enums ----------

export const userStatusEnum = pgEnum("user_status", ["active", "inactive", "deleted"]);
export const emailFrequencyEnum = pgEnum("email_frequency", ["daily", "weekly", "never"]);
export const commentVisibilityEnum = pgEnum("comment_visibility", ["public", "team", "private"]);
export const teamMemberRoleEnum = pgEnum("team_member_role", ["admin", "member", "viewer"]);
export const emailQueueStatusEnum = pgEnum("email_queue_status", ["pending", "sent", "failed"]);
export const apiKeyTierEnum = pgEnum("api_key_tier", ["starter", "pro", "enterprise"]);

// Phase 12e.1 ingestion enums.
export const ingestionAdapterTypeEnum = pgEnum("ingestion_adapter_type", [
  "rss",
  "arxiv_atom",
  "sec_edgar_json",
  "hackernews_api",
  "reddit_api",
]);
export const ingestionCandidateStatusEnum = pgEnum("ingestion_candidate_status", [
  "discovered",
  "heuristic_passed",
  "heuristic_filtered",
  "llm_rejected",
  "llm_relevant",
  "facts_extracted",
  "tier_generated",
  "enriching",
  "published",
  "duplicate",
  "failed",
]);

export const INGESTION_ADAPTER_TYPES = [
  "rss",
  "arxiv_atom",
  "sec_edgar_json",
  "hackernews_api",
  "reddit_api",
] as const;
export type IngestionAdapterType = (typeof INGESTION_ADAPTER_TYPES)[number];

export const INGESTION_CANDIDATE_STATUSES = [
  "discovered",
  "heuristic_passed",
  "heuristic_filtered",
  "llm_rejected",
  "llm_relevant",
  "facts_extracted",
  "tier_generated",
  "enriching",
  "published",
  "duplicate",
  "failed",
] as const;
export type IngestionCandidateStatus = (typeof INGESTION_CANDIDATE_STATUSES)[number];

export const EVENT_SOURCE_ROLES = ["primary", "alternate"] as const;
export type EventSourceRole = (typeof EVENT_SOURCE_ROLES)[number];

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
export const DEPTH_PREFERENCES = ["accessible", "briefed", "technical"] as const;
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
export const DEPTH_LEVELS = ["accessible", "briefed", "technical"] as const;
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

// Phase 12e.7a — story_id is now nullable; rows target either a story or
// an event (mutually exclusive, enforced at the DB level by the
// `user_saves_exactly_one_target` CHECK in migration 0023). The partial
// unique index `user_saves_user_event_unique` covers the event branch;
// the existing `user_saves_user_story_unique` still covers the story
// branch (Postgres NULLs are distinct, so event-save rows with story_id
// NULL never collide on the story-side index).
export const userSaves = pgTable(
  "user_saves",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    storyId: uuid("story_id").references(() => stories.id, { onDelete: "cascade" }),
    eventId: uuid("event_id").references(() => events.id, { onDelete: "cascade" }),
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

// Phase 12e.7a — story_id is nullable as of migration 0023; comments
// target either a story or an event (CHECK constraint
// `comments_exactly_one_target` enforces exactly one). New event-side
// queries use the partial `comments_event_idx` (event_id WHERE NOT NULL).
export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storyId: uuid("story_id").references(() => stories.id, { onDelete: "cascade" }),
    eventId: uuid("event_id").references(() => events.id, { onDelete: "cascade" }),
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
//
// Phase 12e.7b. The story_id FK was dropped (migration 0024) so the
// column can carry either a stories.id or an events.id (single UUID
// namespace). The column stays NOT NULL and uuid; only the FK
// constraint was removed. Cascade-delete from stories no longer fires
// for cache rows; orphaned rows from deleted events are handled by the
// 12c.1 GC stub when it ships.

export const commentaryCache = pgTable(
  "commentary_cache",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    storyId: uuid("story_id").notNull(),
    depth: text("depth").$type<DepthLevel>().notNull(),
    profileVersion: integer("profile_version").notNull(),
    commentary: jsonb("commentary")
      .$type<{ thesis: string; support: string }>()
      .notNull(),
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

// ---------- Phase 12e ingestion tables ----------
//
// Curated catalog of content sources polled by the ingestion workers
// under backend/src/jobs/ingestion/. Seeded with the 42-source registry
// in migration 0014. Each row has a paired `writers` row reachable via
// `paired_writer_id` so feed bylines reflect source provenance.
//
// `endpoint` is nullable specifically so the FRED row can land seeded-
// disabled without a placeholder URL — the FRED adapter is deferred
// post-launch (roadmap §13).
export const ingestionSources = pgTable(
  "ingestion_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    displayName: text("display_name").notNull(),
    adapterType: ingestionAdapterTypeEnum("adapter_type").notNull(),
    endpoint: text("endpoint"),
    sectors: text("sectors").array().notNull(),
    fetchIntervalSeconds: integer("fetch_interval_seconds").notNull().default(1800),
    qualityScore: smallint("quality_score").notNull().default(5),
    // Phase 12e.6b: lower = higher priority. Drives primary-source
    // promotion on cluster match. 1=lab/SEC, 2=analyst, 3=news, 4=community.
    priority: integer("priority").notNull().default(3),
    enabled: boolean("enabled").notNull().default(true),
    pairedWriterId: uuid("paired_writer_id").references(() => writers.id, {
      onDelete: "set null",
    }),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
    // Phase 12e.8 — last successful poll per source. Distinct from
    // lastPolledAt, which records every attempt (success or failure).
    // Null = source has never successfully polled. Written by
    // sourcePollJob on the success branch only.
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    consecutiveFailureCount: integer("consecutive_failure_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    enabledIntervalIdx: index("ingestion_sources_enabled_interval_idx").on(
      t.enabled,
      t.fetchIntervalSeconds,
    ),
  }),
);

// Event-centric data model (Phase 12e). One real-world event = one
// `events` row with one or more linked `event_sources` rows. The
// existing `stories` table is preserved untouched through 12e for
// backward compatibility; deprecation is post-launch.
//
// `why_it_matters_template` mirrors `stories.why_it_matters_template` —
// TEXT-as-JSON of `WhyItMattersTemplate` consumed via the same parser
// at backend/src/utils/depthVariants.ts.
//
// `embedding` is `vector(1536)` (OpenAI text-embedding-3-small). Populated
// by the 12e.6a embedding seam on the new-event write path; consumed by
// the trailing-72h cluster-match check via cosine similarity (`<=>`).
// `facts` is JSONB; populated by the 12e.5a fact-extraction worker.
export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sector: varchar("sector", { length: 50 }).notNull(),
    headline: varchar("headline", { length: 255 }).notNull(),
    context: text("context").notNull(),
    whyItMatters: text("why_it_matters").notNull(),
    whyItMattersTemplate: text("why_it_matters_template"),
    primarySourceUrl: text("primary_source_url").notNull(),
    primarySourceName: varchar("primary_source_name", { length: 255 }),
    authorId: uuid("author_id").references(() => writers.id, { onDelete: "set null" }),
    facts: jsonb("facts").$type<Record<string, unknown>>().notNull().default({}),
    embedding: vector("embedding", { dimensions: 1536 }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    sectorPublishedIdx: index("events_sector_published_at_idx").on(t.sector, t.publishedAt),
    createdAtIdx: index("events_created_at_idx").on(t.createdAt),
  }),
);

// Multi-source attribution. Exactly one `role = 'primary'` per event
// (enforced by partial unique index in migration 0015); any number of
// `role = 'alternate'` rows. Deleting an `ingestion_sources` row sets
// the FK null rather than cascading — the event keeps its source
// history even if the catalog row goes away.
export const eventSources = pgTable(
  "event_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    ingestionSourceId: uuid("ingestion_source_id").references(() => ingestionSources.id, {
      onDelete: "set null",
    }),
    url: text("url").notNull(),
    name: varchar("name", { length: 255 }),
    role: text("role").$type<EventSourceRole>().notNull().default("alternate"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    eventUrlUnique: unique("event_sources_event_id_url_key").on(t.eventId, t.url),
    eventIdx: index("event_sources_event_idx").on(t.eventId),
  }),
);

// Per-candidate row representing one item pulled from a source. The
// pipeline advances `status` through the enum values as candidates
// pass each filter / enrichment stage; terminal states are
// `published` (made it to events), `duplicate` (clustered onto an
// existing event), and `failed` (dead-lettered).
export const ingestionCandidates = pgTable(
  "ingestion_candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ingestionSourceId: uuid("ingestion_source_id")
      .notNull()
      .references(() => ingestionSources.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    url: text("url").notNull(),
    rawTitle: text("raw_title"),
    rawSummary: text("raw_summary"),
    rawPublishedAt: timestamp("raw_published_at", { withTimezone: true }),
    rawPayload: jsonb("raw_payload").$type<Record<string, unknown>>().notNull().default({}),
    contentHash: text("content_hash"),
    bodyText: text("body_text"),
    sector: text("sector"),
    llmJudgmentRaw: jsonb("llm_judgment_raw").$type<Record<string, unknown>>(),
    facts: jsonb("facts").$type<Record<string, unknown>>(),
    factsExtractedAt: timestamp("facts_extracted_at", { withTimezone: true }),
    factsExtractionRaw: jsonb("facts_extraction_raw").$type<Record<string, unknown>>(),
    tierOutputs: jsonb("tier_outputs").$type<Record<string, unknown>>(),
    tierGeneratedAt: timestamp("tier_generated_at", { withTimezone: true }),
    tierOutputsRaw: jsonb("tier_outputs_raw").$type<Record<string, unknown>>(),
    embedding: vector("embedding", { dimensions: 1536 }),
    status: ingestionCandidateStatusEnum("status").notNull().default("discovered"),
    statusReason: text("status_reason"),
    resolvedEventId: uuid("resolved_event_id").references(() => events.id, {
      onDelete: "set null",
    }),
    discoveredAt: timestamp("discovered_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => ({
    sourceExternalIdUnique: unique("ingestion_candidates_source_external_id_key").on(
      t.ingestionSourceId,
      t.externalId,
    ),
    statusDiscoveredIdx: index("ingestion_candidates_status_discovered_idx").on(
      t.status,
      t.discoveredAt,
    ),
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
export type IngestionSource = typeof ingestionSources.$inferSelect;
export type NewIngestionSource = typeof ingestionSources.$inferInsert;
export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type EventSource = typeof eventSources.$inferSelect;
export type NewEventSource = typeof eventSources.$inferInsert;
export type IngestionCandidate = typeof ingestionCandidates.$inferSelect;
export type NewIngestionCandidate = typeof ingestionCandidates.$inferInsert;
