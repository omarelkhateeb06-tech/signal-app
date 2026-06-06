-- 0047 — Phase 12R.A: add the 'github_api' ingestion adapter type.
--
-- A new Postgres enum value cannot be USED in the same transaction that adds
-- it (the migration runner wraps each file in one transaction). So this file
-- only ADDs the value; migration 0048 seeds a source that uses it. Mirrors the
-- 0036/0037 add-value / use-value split. Idempotent via IF NOT EXISTS.

ALTER TYPE "ingestion_adapter_type" ADD VALUE IF NOT EXISTS 'github_api';
