-- 0052 — Phase 12 ingestion Tier 1: add the 'fred_api' adapter type.
--
-- A new Postgres enum value cannot be USED in the same transaction that adds
-- it (the migration runner wraps each file in one transaction). So this file
-- only ADDs the value; migration 0053 repoints the fred-api source row at it.
-- Mirrors the 0047/0048 (github_api) and 0050/0051 (sec_form_d) add-value /
-- use-value split. Idempotent via IF NOT EXISTS.

ALTER TYPE "ingestion_adapter_type" ADD VALUE IF NOT EXISTS 'fred_api';
