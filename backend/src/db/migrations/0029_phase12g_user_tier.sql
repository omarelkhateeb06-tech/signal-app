-- Phase 12g — Paywall gating: tier model on users.
--
-- Two-tier system (Free / Pro) with a 7-day `pro_trial` bridge state.
-- New signups default to 'pro_trial'; `trial_started_at` is set in the
-- signup path; the gating middleware in src/middleware/requireTier.ts
-- lazy-downgrades expired trials to 'free' on next request (no cron).
--
-- `tier` is a CHECK-constrained text column rather than a pgEnum: the
-- value set is expected to evolve (V3 reinstates a 'premium' tier for
-- the course library) and CHECK constraints are cheap to swap (single
-- DROP / ADD vs the enum drop/rename dance). Matches the
-- depth_preference / digest_preference pattern from 0008.
--
-- Backfill: existing rows (test / dev users — prod has no real paying
-- customers yet) get 'pro_trial' + `trial_started_at = now()` so the
-- 7-day downgrade path is exercisable end-to-end on every pre-12g
-- account. `tier_changed_at` stays NULL until a tier mutation happens.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "tier" text NOT NULL DEFAULT 'pro_trial';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "trial_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "tier_changed_at" timestamp with time zone;--> statement-breakpoint

-- Backfill: ADD COLUMN's DEFAULT already wrote 'pro_trial' to every
-- existing row; this UPDATE anchors the 7-day window. Idempotent — only
-- touches rows whose trial has not been anchored yet, so re-running
-- against a partially-migrated DB does not extend any user's trial.
UPDATE "users"
SET "trial_started_at" = now()
WHERE "trial_started_at" IS NULL AND "tier" = 'pro_trial';--> statement-breakpoint

ALTER TABLE "users"
  ADD CONSTRAINT "users_tier_check"
  CHECK ("tier" IN ('free', 'pro_trial', 'pro'));
