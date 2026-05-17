-- Phase 12e.x fix cluster — enrichment recovery columns on
-- ingestion_candidates.
--
-- Background. Events that fail mid-enrichment (e.g. Haiku timeout on
-- one tier of three) get stuck with partial `tier_outputs`. The
-- candidate row carries the partial state but the worker loop won't
-- re-queue it because the candidate's status is still pre-terminal
-- and there's no scheduler watching for the gap. Result: candidates
-- silently stall. The recovery scheduler queries for these and
-- re-enqueues them, tracking attempt count + a terminal-failure
-- flag so we don't retry forever.
--
-- Columns:
--   recovery_attempts  — number of times the recovery scheduler has
--                        re-enqueued this candidate. Bumped each
--                        time the scheduler picks the row; capped at
--                        3 before the row is marked
--                        enrichment_failed=true and ignored.
--   enrichment_failed  — terminal flag. Set to true after 3 failed
--                        recovery attempts so the row stops appearing
--                        in detection queries. Manual review only
--                        beyond that point.
--
-- Both default to safe values (0 / false) so the migration is a no-op
-- on every existing row.

ALTER TABLE "ingestion_candidates"
  ADD COLUMN IF NOT EXISTS "recovery_attempts" integer NOT NULL DEFAULT 0;--> statement-breakpoint

ALTER TABLE "ingestion_candidates"
  ADD COLUMN IF NOT EXISTS "enrichment_failed" boolean NOT NULL DEFAULT false;
