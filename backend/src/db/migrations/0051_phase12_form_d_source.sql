-- 0051 — Phase 12 ingestion Tier 1: SEC Form D private-financing source.
--
-- Reg D exempt offerings ("an operating company raised a private round")
-- discovered via EDGAR full-text search (EFTS), then filtered by industry
-- group + a disclosed offering size. Uses the 'sec_form_d' enum value added
-- in 0050. content_type='filing' so the feed renders these as the EARNINGS/
-- SEC data card (shared with sec_edgar_json). Multi-sector: the Haiku
-- relevance gate assigns ai/finance/semiconductors per filing and rejects
-- off-topic ones. priority 1 (regulator primary), polled daily.
--
-- config carries the adapter's pre-filter knobs so tuning is a data change:
--   contentType        'filing' — feed-card classification (read by writeEvent)
--   minOfferingUsd     disclosed-offering floor (5,000,000)
--   maxFilings         per-poll cap on EFTS hits processed (150)
--   lookbackDays       window when the source has never polled (2)
--   industryAllowlist  operating-tech only by default; fund categories
--                      (Pooled Investment Fund, ...) deliberately excluded —
--                      a live sample showed they are ~85% LP/SPV noise.
-- Idempotent guard so re-applying is a clean no-op.

INSERT INTO ingestion_sources
  (slug, display_name, adapter_type, endpoint, sectors,
   fetch_interval_seconds, quality_score, priority, enabled, config)
SELECT
  'sec-form-d',
  'SEC Form D',
  'sec_form_d'::ingestion_adapter_type,
  'https://efts.sec.gov/LATEST/search-index',
  ARRAY['ai','finance','semiconductors'],
  86400,
  7::smallint,
  1,
  true,
  '{"contentType":"filing","minOfferingUsd":5000000,"maxFilings":150,"lookbackDays":2,"industryAllowlist":["Computers","Other Technology","Telecommunications","Manufacturing"]}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM ingestion_sources s WHERE s.slug = 'sec-form-d'
);
