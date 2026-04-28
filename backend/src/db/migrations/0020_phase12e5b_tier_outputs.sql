-- Phase 12e.5b — tier-generation schema additions.
--
-- 1. Extend ingestion_candidate_status with `tier_generated`. Positive-
--    marker state for candidates whose three depth-tier commentary
--    payloads (accessible / briefed / technical) have all been generated
--    and are awaiting event-write (12e.5c). Symmetric with 12e.4
--    `llm_relevant` and 12e.5a `facts_extracted`. Placed after
--    `facts_extracted` in enum order to keep the status diagram legible.
--
-- 2. Add nullable `tier_outputs` jsonb column. Keyed by tier name —
--    {accessible: {thesis, support}, briefed: {...}, technical: {...}}.
--    Populated incrementally via jsonb_set as each tier completes;
--    partial state is observable from the column shape. Status advance
--    to `tier_generated` is gated on all three keys being present.
--    12e.5c copies this blob to events.why_it_matters_template at
--    event-write time; this column is the staging surface for the
--    duration of the candidate's lifecycle.
--
-- 3. Add nullable `tier_generated_at` timestamptz column. Idempotency
--    marker; set only when all three tier keys are present in
--    tier_outputs. CLI / future worker query filter is
--      `WHERE status='facts_extracted' OR
--             (status='tier_generated' AND tier_generated_at IS NULL)`
--    for re-entry into the partial-state retry path. The seam itself
--    does not short-circuit; orchestrator owns the per-tier presence
--    check.
--
-- 4. Add nullable `tier_outputs_raw` jsonb column. Mirrors 12e.5a's
--    `facts_extraction_raw`: holds an object keyed by tier name with
--    { model, promptText, responseText, latencyMs, attempts } per tier.
--    Populated whenever at least one Haiku call returned text — even on
--    terminal-reject paths. Used for the retroactive prompt-quality
--    audit surface in 12e.8.
--
-- ALTER TYPE ADD VALUE is safe inside a transaction on PG 12+ as long
-- as the new value isn't referenced in the same transaction (it isn't).
-- No backfill — all three new columns are nullable; existing rows have
-- NULL until the worker re-processes them.

ALTER TYPE ingestion_candidate_status ADD VALUE IF NOT EXISTS 'tier_generated' AFTER 'facts_extracted';

ALTER TABLE ingestion_candidates
  ADD COLUMN tier_outputs jsonb;

ALTER TABLE ingestion_candidates
  ADD COLUMN tier_generated_at timestamptz;

ALTER TABLE ingestion_candidates
  ADD COLUMN tier_outputs_raw jsonb;
