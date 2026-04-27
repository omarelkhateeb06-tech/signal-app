-- 0013 — Rename the "standard" depth tier to "briefed".
--
-- A product decision renames the middle commentary-depth tier from
-- "standard" to "briefed" both at the user-facing label layer and at
-- the internal enum-value layer. This migration handles the value
-- layer in three places: user_profiles.depth_preference,
-- commentary_cache.depth, and the JSON keys inside
-- stories.why_it_matters_template (a TEXT-as-JSON column per CLAUDE.md
-- §9 — TEXT, not JSONB, with a lenient-on-read parser at
-- backend/src/utils/depthVariants.ts). The two CHECK constraints that
-- pin the allowed value set are dropped and re-added with the new
-- triple {accessible, briefed, technical}.
--
-- Idempotency:
--   - The UPDATEs on user_profiles and commentary_cache are
--     no-ops on a fresh dev DB (no rows yet) and on any DB
--     where the tier has already been remapped.
--   - The stories JSON remap is gated on the row holding all three
--     post-12a keys; legacy {ai, finance, semiconductors} payloads,
--     NULLs, and rows already in {accessible, briefed, technical}
--     pass through unchanged.

-- Drop CHECK constraints so the UPDATEs can land.
ALTER TABLE "user_profiles" DROP CONSTRAINT IF EXISTS "user_profiles_depth_preference_check";--> statement-breakpoint
ALTER TABLE "commentary_cache" DROP CONSTRAINT IF EXISTS "commentary_cache_depth_check";--> statement-breakpoint

-- Remap stored values on the two enum columns.
UPDATE "user_profiles" SET "depth_preference" = 'briefed' WHERE "depth_preference" = 'standard';--> statement-breakpoint
UPDATE "commentary_cache" SET "depth" = 'briefed' WHERE "depth" = 'standard';--> statement-breakpoint

-- Remap the "standard" key to "briefed" inside the
-- stories.why_it_matters_template JSON-as-TEXT payload. Casts to
-- jsonb, rebuilds the object with the renamed key, casts back to
-- text. Guards: rows must look like a JSON object (LIKE '{%') and
-- carry all three post-12a keys before we touch them, so legacy
-- payloads and malformed text rows pass through unchanged.
UPDATE "stories"
SET "why_it_matters_template" = jsonb_build_object(
    'accessible', "why_it_matters_template"::jsonb -> 'accessible',
    'briefed',    "why_it_matters_template"::jsonb -> 'standard',
    'technical',  "why_it_matters_template"::jsonb -> 'technical'
  )::text
WHERE "why_it_matters_template" IS NOT NULL
  AND "why_it_matters_template" LIKE '{%'
  AND ("why_it_matters_template"::jsonb) ? 'accessible'
  AND ("why_it_matters_template"::jsonb) ? 'standard'
  AND ("why_it_matters_template"::jsonb) ? 'technical';--> statement-breakpoint

-- Re-add CHECK constraints with the new value set.
ALTER TABLE "user_profiles"
  ADD CONSTRAINT "user_profiles_depth_preference_check"
  CHECK ("depth_preference" IS NULL OR "depth_preference" IN ('accessible', 'briefed', 'technical'));--> statement-breakpoint

ALTER TABLE "commentary_cache"
  ADD CONSTRAINT "commentary_cache_depth_check"
  CHECK ("depth" IN ('accessible', 'briefed', 'technical'));
