-- 0050 — Phase 12 ingestion Tier 1: add the 'sec_form_d' adapter type.
--
-- A new Postgres enum value cannot be USED in the same transaction that adds
-- it (the migration runner wraps each file in one transaction). So this file
-- only ADDs the value; migration 0051 seeds the source that uses it. Mirrors
-- the 0047/0048 add-value / use-value split. Idempotent via IF NOT EXISTS.

ALTER TYPE "ingestion_adapter_type" ADD VALUE IF NOT EXISTS 'sec_form_d';
