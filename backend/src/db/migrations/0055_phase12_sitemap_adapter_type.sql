-- 0055 — Phase 12 ingestion: add the 'sitemap' adapter type.
--
-- A new Postgres enum value cannot be USED in the same transaction that adds
-- it (the migration runner wraps each file in one transaction). So this file
-- only ADDs the value; migration 0056 repoints anthropic-news at it. Mirrors
-- the 0047/0048 (github_api), 0050/0051 (sec_form_d), 0052/0053 (fred_api)
-- add-value / use-value split. Idempotent via IF NOT EXISTS.

ALTER TYPE "ingestion_adapter_type" ADD VALUE IF NOT EXISTS 'sitemap';
