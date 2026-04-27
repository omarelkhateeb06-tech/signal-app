-- Phase 12e.2 — add content_hash column to ingestion_candidates.
--
-- Stage 2 (RSS adapter) populates this on insert with SHA-256 over
-- (canonicalized_url + raw_title + raw_summary), hex-truncated to 32
-- chars. No UNIQUE constraint here on purpose: cross-source duplicates
-- are intentional at the candidate level — clustering / event-merge
-- happens at 12e.6, which will consume this column for lookup.
--
-- Partial index excludes pre-12e.2 rows (which have NULL content_hash);
-- saves a small amount of index space during the rollout window.

ALTER TABLE ingestion_candidates
  ADD COLUMN content_hash text;

CREATE INDEX ingestion_candidates_content_hash_idx
  ON ingestion_candidates (content_hash)
  WHERE content_hash IS NOT NULL;
