-- Phase 12e.8 — track last successful poll per source separately from
-- lastPolledAt (which records last attempt, success or failure).
-- Nullable: NULL means the source has never successfully polled.
ALTER TABLE ingestion_sources
  ADD COLUMN last_success_at TIMESTAMPTZ;
