-- 0036 — Phase 12n.2: native posts, part 1 (enum value + events.source_type).
--
-- Native posts are AI-authored editorial content synthesized from already-
-- ingested signals (GitHub trending first; arXiv / HN / filings later).
-- They live in the SAME `events` table as ingested stories — there is no
-- separate native table — and are distinguished by a `source_type` flag.
--
-- Two data-model changes, both safe in one transaction because NEITHER
-- statement *uses* the newly-added enum value (Postgres forbids using a
-- new enum label in the same transaction that adds it — see the runner
-- note in migrate.ts; that's why the native `ingestion_sources` INSERT,
-- which DOES use 'native_generator', is split into 0037):
--
--   1. ALTER TYPE — add 'native_generator' to ingestion_adapter_type. A
--      native generator is registered as an ingestion source whose
--      adapter_type is this value; the source has no poll adapter (its
--      registry slot is null) and is driven by the native generation CLI
--      instead of the RSS poll scheduler.
--
--   2. ALTER TABLE — add events.source_type. Default 'ingested' so every
--      existing row reads as ingested with no backfill UPDATE required
--      (ADD COLUMN ... DEFAULT populates existing rows). NOT NULL + CHECK
--      constrains it to the two values this phase ships. writeEvent.ts
--      sets the column from the source's adapter_type at write time
--      ('native_generator' → 'native', else 'ingested').

ALTER TYPE ingestion_adapter_type ADD VALUE IF NOT EXISTS 'native_generator';--> statement-breakpoint

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'ingested'
    CHECK (source_type IN ('ingested', 'native'));--> statement-breakpoint

-- Belt-and-suspenders: the DEFAULT above already populates pre-existing
-- rows, but make the backfill intent explicit and idempotent. No-op on a
-- fresh column where every row is already 'ingested'.
UPDATE events SET source_type = 'ingested' WHERE source_type IS NULL;
