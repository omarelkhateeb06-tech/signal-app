-- Phase 12g — pre-generated role-neutral commentary column for Free
-- users. Two columns added: `stories.generic_commentary` and
-- `events.generic_commentary`. Plain TEXT, nullable.
--
-- Rationale: Free-tier users get role-neutral commentary; Pro users
-- continue getting personalized (Haiku) commentary per the existing
-- 12c pipeline. Storing the role-neutral text once per row keeps the
-- Free path zero-latency and zero-cost (no Haiku call), and a single
-- column means the read-side branch is a one-liner instead of a JSON
-- parse on every request.
--
-- Source of truth at write time:
--   - events: the `tier_outputs.accessible` payload (thesis+support
--     concatenated) populated by writeEvent in the ingestion tail.
--   - stories: the legacy 12a accessible variant from
--     `why_it_matters_template`, populated by the backfill script
--     `npm run backfill-generic-commentary`.
--
-- Existing rows (pre-12g) are NULL until the backfill runs. The
-- read-side path falls back to `why_it_matters` when the column is
-- null, so the column going live with NULLs is a no-op visible to
-- users — same behavior as today.

ALTER TABLE "stories" ADD COLUMN IF NOT EXISTS "generic_commentary" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "generic_commentary" text;
