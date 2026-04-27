-- Phase 12e.3 — heuristic stage schema additions.
--
-- 1. Extend ingestion_candidate_status with `heuristic_passed`. This is
--    the new positive-marker state for candidates that cleared the
--    heuristic checks (recency, length, noise) AND had their body
--    successfully fetched + extracted. `heuristic_filtered` remains
--    the rejection terminal — see HEURISTIC_REASONS in
--    backend/src/jobs/ingestion/heuristics.ts for the status_reason
--    vocabulary.
--
-- 2. Add a nullable `body_text` column to ingestion_candidates. Stores
--    the readability-extracted plain text (post-jsdom). 200 KB cap is
--    enforced application-side; exceeding rows are truncated and
--    flagged with status_reason = 'body_truncated' (informational only,
--    candidate still passes).
--
-- ALTER TYPE ADD VALUE is safe inside a transaction on PG 12+ as long
-- as the new value isn't referenced in the same transaction (it isn't).

ALTER TYPE ingestion_candidate_status ADD VALUE IF NOT EXISTS 'heuristic_passed';

ALTER TABLE ingestion_candidates
  ADD COLUMN body_text text;
