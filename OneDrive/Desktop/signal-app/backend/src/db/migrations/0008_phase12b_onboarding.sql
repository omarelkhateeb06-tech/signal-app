-- Phase 12b: profile questionnaire (7-screen onboarding).
--
-- ALTER, don't CREATE: user_profiles already exists and is used by the
-- unsubscribe flow. Keep email_frequency + email_unsubscribed intact,
-- add the five new nullable columns, and convert sectors/goals from
-- jsonb to text[] so lookups and membership checks use the native
-- Postgres array type instead of JSON operators.
--
-- The onboarding-complete predicate is `completed_at IS NOT NULL`,
-- NOT "row exists". Existing profile rows (from the unsubscribe flow)
-- are treated as incomplete by design — those users will onboard on
-- next login like everyone else. No backfill is appropriate here; dev
-- and staging users can re-onboard, and prod has no real users yet.
--
-- depth_preference and digest_preference are stored as text with a
-- CHECK constraint rather than a pgEnum. Enums require a drop/rename
-- dance to evolve; CHECK constraints can be replaced with a single
-- `DROP CONSTRAINT ... ADD CONSTRAINT ...` when the set changes.

-- ---------- user_profiles alterations ----------

-- jsonb → text[] for sectors / goals. USING explicitly unwraps the JSON
-- array to a text array; failing the cast on a non-array value is the
-- correct behavior (it would indicate data corruption).
ALTER TABLE "user_profiles"
	ALTER COLUMN "sectors" TYPE text[]
	USING CASE
		WHEN "sectors" IS NULL THEN NULL
		ELSE ARRAY(SELECT jsonb_array_elements_text("sectors"))
	END;--> statement-breakpoint

ALTER TABLE "user_profiles"
	ALTER COLUMN "goals" TYPE text[]
	USING CASE
		WHEN "goals" IS NULL THEN NULL
		ELSE ARRAY(SELECT jsonb_array_elements_text("goals"))
	END;--> statement-breakpoint

ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "seniority" text;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "depth_preference" text;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "digest_preference" text;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "timezone" text;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "completed_at" timestamp with time zone;--> statement-breakpoint

-- CHECK constraints enforce the three-value enum at the DB boundary.
-- `IS NULL OR IN (...)` allows the partial-profile state between signup
-- and onboarding completion without dropping schema-level enforcement.
ALTER TABLE "user_profiles"
	ADD CONSTRAINT "user_profiles_depth_preference_check"
	CHECK ("depth_preference" IS NULL OR "depth_preference" IN ('accessible', 'standard', 'technical'));--> statement-breakpoint

ALTER TABLE "user_profiles"
	ADD CONSTRAINT "user_profiles_digest_preference_check"
	CHECK ("digest_preference" IS NULL OR "digest_preference" IN ('morning', 'evening', 'none'));--> statement-breakpoint

-- ---------- user_topic_interests ----------
--
-- Per-sector topic selections from Screen 5. Normalized out of
-- user_profiles so we can index (user_id, sector) efficiently and
-- filter on individual topics without array containment queries.
-- Composite PK (user_id, sector, topic) makes re-inserts idempotent
-- and free of duplicates without a separate unique constraint.

CREATE TABLE IF NOT EXISTS "user_topic_interests" (
	"user_id" uuid NOT NULL,
	"sector" text NOT NULL,
	"topic" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_topic_interests_pk" PRIMARY KEY ("user_id", "sector", "topic"),
	CONSTRAINT "user_topic_interests_user_id_fk"
		FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "user_topic_interests_user_idx"
	ON "user_topic_interests" USING btree ("user_id");--> statement-breakpoint

-- ---------- onboarding_events ----------
--
-- Append-only telemetry for the onboarding funnel. Written from both
-- the batched `/onboarding/events` endpoint and the completion path.
-- metadata is jsonb so event-specific payloads (e.g. skip reason,
-- time-on-screen) can evolve without schema changes.
--
-- UUID PK to match the rest of the schema (never serial). Index on
-- (user_id, created_at) supports per-user timeline reads; a separate
-- index on event_type supports funnel queries that aggregate across
-- users.

CREATE TABLE IF NOT EXISTS "onboarding_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"screen_number" integer,
	"metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "onboarding_events_user_id_fk"
		FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "onboarding_events_user_created_idx"
	ON "onboarding_events" USING btree ("user_id", "created_at");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "onboarding_events_type_idx"
	ON "onboarding_events" USING btree ("event_type");
