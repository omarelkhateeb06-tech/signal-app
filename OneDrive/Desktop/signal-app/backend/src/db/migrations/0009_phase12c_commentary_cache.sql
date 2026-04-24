-- Phase 12c: per-user, per-story Haiku-generated commentary.
--
-- Two user_profiles additions + one new cache table. The v2 prompt
-- originally named `users` as the target table; we put these on
-- `user_profiles` to match the 12b pattern (every onboarding-captured
-- field — seniority, depth_preference, digest_preference, timezone —
-- lives there) and to avoid a cross-table JOIN on every commentary
-- lookup.
--
-- `domain` is nullable at the DB boundary, same shape as the other
-- onboarding-captured fields. `user_profiles` rows can exist pre-
-- onboarding (created by the unsubscribe flow — see 0008's comment
-- block); the authoritative "is this user onboarded" predicate is
-- `completed_at IS NOT NULL`, and Zod at the /onboarding/complete
-- endpoint enforces `domain` is a non-empty string. A CHECK constraint
-- rejects empty strings at the DB so a partial write can't smuggle
-- an empty value past the zod guard.
--
-- `profile_version` starts at 1 and increments on any post-onboarding
-- mutation to role / domain / seniority / sectors / topics / goals
-- (via Settings). Onboarding completion inserts with the default 1 —
-- it does not bump. NOT NULL DEFAULT 1 is safe because the DEFAULT
-- fills any existing rows during the ALTER, and every insert path
-- will either rely on the default or set it explicitly.
--
-- commentary_cache is append-only. Key: (user_id, story_id, depth,
-- profile_version). A cache hit short-circuits the Haiku call; a
-- miss triggers regeneration. Depth and profile_version are part of
-- the key so changing either invalidates prior rows without an
-- explicit delete — stale rows are reaped by a stub GC function
-- (documented but unscheduled in 12c; actual scheduling in 12c.1).
-- Depth is enforced via CHECK rather than a new pgEnum, matching the
-- depth_preference pattern from 0008.

-- ---------- user_profiles alterations ----------

ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "domain" text;--> statement-breakpoint

ALTER TABLE "user_profiles"
	ADD CONSTRAINT "user_profiles_domain_check"
	CHECK ("domain" IS NULL OR length("domain") > 0);--> statement-breakpoint

ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "profile_version" integer NOT NULL DEFAULT 1;--> statement-breakpoint

-- ---------- commentary_cache ----------

CREATE TABLE IF NOT EXISTS "commentary_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"story_id" uuid NOT NULL,
	"depth" text NOT NULL,
	"profile_version" integer NOT NULL,
	"commentary" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commentary_cache_depth_check"
		CHECK ("depth" IN ('accessible', 'standard', 'technical')),
	CONSTRAINT "commentary_cache_user_id_fk"
		FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
	CONSTRAINT "commentary_cache_story_id_fk"
		FOREIGN KEY ("story_id") REFERENCES "stories"("id") ON DELETE CASCADE,
	CONSTRAINT "commentary_cache_key_unique"
		UNIQUE ("user_id", "story_id", "depth", "profile_version")
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "commentary_cache_user_idx"
	ON "commentary_cache" USING btree ("user_id");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "commentary_cache_user_story_idx"
	ON "commentary_cache" USING btree ("user_id", "story_id");
