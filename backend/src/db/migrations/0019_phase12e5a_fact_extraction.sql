-- Phase 12e.5a — fact-extraction schema additions.
--
-- 1. Extend ingestion_candidate_status with `facts_extracted`. The new
--    positive-marker state for candidates that have a structured-facts
--    blob persisted AND are awaiting tier generation (12e.5b).
--    Symmetric with the 12e.3 `heuristic_passed` and 12e.4
--    `llm_relevant` adds.
--
-- 2. Add nullable `facts` jsonb column to ingestion_candidates. Stores
--    the parsed `{ facts: [{ text, category }, ...] }` payload returned
--    by Haiku. 12e.5c orchestration copies this blob to events.facts at
--    event-write time; this column is the staging surface for the
--    duration of the candidate's lifecycle.
--
-- 3. Add nullable `facts_extracted_at` timestamptz column. Idempotency
--    marker; CLI / future worker query filter is
--      `WHERE status='llm_relevant' AND facts_extracted_at IS NULL`.
--    The seam itself does not short-circuit on already-extracted
--    candidates — gating is at the query level.
--
-- 4. Add nullable `facts_extraction_raw` jsonb column. Mirrors 12e.4's
--    `llm_judgment_raw`: holds { model, promptText, responseText,
--    latencyMs, attempts } for the retroactive prompt-quality audit
--    surface (G6 of the 12e.5a stage 1 audit). Populated whenever at
--    least one Haiku call returned text — even on terminal-reject
--    paths.
--
-- ALTER TYPE ADD VALUE is safe inside a transaction on PG 12+ as long
-- as the new value isn't referenced in the same transaction (it isn't).
-- No backfill — all three new columns are nullable; existing rows have
-- NULL until the worker re-processes them.

ALTER TYPE ingestion_candidate_status ADD VALUE IF NOT EXISTS 'facts_extracted';

ALTER TABLE ingestion_candidates
  ADD COLUMN facts jsonb;

ALTER TABLE ingestion_candidates
  ADD COLUMN facts_extracted_at timestamptz;

ALTER TABLE ingestion_candidates
  ADD COLUMN facts_extraction_raw jsonb;
