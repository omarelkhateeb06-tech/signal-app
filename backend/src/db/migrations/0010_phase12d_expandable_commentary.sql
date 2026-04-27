-- Phase 12d: expandable commentary (issues #23, #20).
--
-- The commentary_cache.commentary column moves from a single TEXT blob to
-- JSONB carrying the structured shape `{ thesis: string, support: string }`.
-- Thesis is what's visible by default; support is revealed by "Go deeper".
--
-- Cache wipe rather than backfill: the prior 12c rows are unstructured
-- single-string commentaries. Splitting them post-hoc into thesis + support
-- would either require a second Haiku pass per row (cost/latency, defeating
-- the purpose) or a heuristic split (unreliable). First feed view per
-- (user, story, depth) post-deploy regenerates against the new prompt and
-- writes the new shape — same dynamic as cache invalidation on
-- profile_version bump.
--
-- Cache key (user_id, story_id, depth, profile_version) is unchanged.
-- Expand/collapse is pure frontend session state per Decision 12d.3.
--
-- Column drop+add is safe because the DELETE on the line above leaves the
-- table empty — there is no data to coerce. ADD COLUMN ... NOT NULL on an
-- empty table needs no DEFAULT.

DELETE FROM "commentary_cache";--> statement-breakpoint

ALTER TABLE "commentary_cache" DROP COLUMN "commentary";--> statement-breakpoint

ALTER TABLE "commentary_cache" ADD COLUMN "commentary" jsonb NOT NULL;
