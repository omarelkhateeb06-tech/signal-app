-- 0021 — Phase 12e.6a: pgvector extension, events.embedding bytea→vector(1536),
-- ingestion_candidates.embedding vector(1536) added.
--
-- Embedding model pinned at OpenAI text-embedding-3-small (1536 dimensions).
-- Cosine similarity drives the trailing-72h cluster-match check in 12e.6a;
-- the two-branch dispatch consuming the result lands in 12e.6b.
--
-- IMPORTANT: requires pgvector-enabled Postgres. The smoke harness uses
-- pgvector/pgvector:pg16 (replacing the postgres:16-alpine image used in
-- prior smoke writeups). Railway production Postgres must be migrated to a
-- pgvector-enabled service before this migration can be applied to prod —
-- captured in CLAUDE.md §7.

CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint

-- Convert events.embedding from the 12e.1 bytea placeholder to vector(1536).
-- DROP+ADD is acceptable because the placeholder is uniformly NULL today —
-- 12e.5c writes never populated it, so there is no production data to
-- preserve across the type change.
ALTER TABLE events DROP COLUMN embedding;--> statement-breakpoint
ALTER TABLE events ADD COLUMN embedding vector(1536);--> statement-breakpoint

-- Per-candidate embedding storage. Computed post-relevance-gate by the
-- 12e.6a embedding seam and persisted to ingestion_candidates so the
-- cluster-match decision is addressable from the candidate row without a
-- recompute. Nullable: candidates whose embedding seam fails (API error,
-- empty body) keep status advancing through facts/tiers via the soft-fail
-- path in enrichmentJob.
ALTER TABLE ingestion_candidates ADD COLUMN embedding vector(1536);--> statement-breakpoint

-- Cosine-similarity index on events.embedding for the trailing-72h cluster
-- check. ivfflat with 100 lists is appropriate for the v1 scale; a switch
-- to hnsw can land in a follow-up once row counts justify it. The index
-- only matters once events.embedding starts being populated by 12e.6b's
-- new-event write path; existing rows (NULL embedding) are skipped by the
-- IS NOT NULL filter in the cluster-check query.
CREATE INDEX events_embedding_cosine_idx
  ON events
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
