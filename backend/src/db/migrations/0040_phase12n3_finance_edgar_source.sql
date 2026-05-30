-- 0040 — Phase 12n.3 follow-up: Finance EDGAR sec_edgar_json source + re-enable EDGAR.
--
-- The earnings-reaction-native generator (slug 'earnings-reaction-native',
-- migration 0039) is Finance-primary. Its discover query joins
--   events -> primary event_sources -> ingestion_sources
--   WHERE adapter_type = 'sec_edgar_json' AND events.created_at > now - 48h
-- so it can only ever fire when EDGAR filings are flowing through a
-- sec_edgar_json source. At the time of this migration there were none:
--   - sec-edgar-full   — converted to adapter_type='rss' in 0026 (its
--                        getcurrent endpoint returns Atom, not JSON) AND
--                        disabled. Does not match the generator's filter.
--   - sec-edgar-semis  — sec_edgar_json, but Semis-tagged AND disabled.
-- (Both EDGAR rows were disabled out-of-band — 0028 never touched them —
--  so the disabled state is prod drift this migration now reconciles.)
--
-- This migration:
--   1. Seeds a new Finance sec_edgar_json source ('sec-edgar-finance')
--      mirroring sec-edgar-semis's shape: the data.sec.gov submissions
--      endpoint + a config.ciks list (NOT sec-edgar-full's Atom feed —
--      the sec_edgar_json adapter fetches per-CIK from config.ciks and
--      ignores the endpoint string, see adapters/secEdgarJson.ts). CIKs
--      are 16 major financial filers, each verified against SEC's
--      authoritative company_tickers.json.
--   2. Re-enables sec-edgar-semis so the generator's Semis reaction path
--      also has filings flowing.
--
-- The sec_edgar_json adapter selects on a hardcoded RELEVANT_FORMS set
-- (10-K, 10-Q, 8-K, S-1, 20-F); config.formTypeAllowlist is an rss-adapter
-- concern (sec-edgar-full) and is intentionally NOT set here.
--
-- Each step is guarded (NOT EXISTS / enabled = false) so re-applying is a
-- no-op. Settings mirror sec-edgar-semis: quality_score 9, priority 1
-- (regulator tier), fetch_interval_seconds 900.

-- ---- 1. Paired byline writer for the finance EDGAR source ----
INSERT INTO writers (name, sectors)
SELECT 'SEC EDGAR (finance CIKs)', '["finance"]'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM writers WHERE name = 'SEC EDGAR (finance CIKs)'
);--> statement-breakpoint

-- ---- 2. Finance sec_edgar_json source ----
-- CIKs (verified against SEC company_tickers.json):
--   JPM 0000019617  BAC 0000070858  WFC 0000072971  GS  0000886982
--   MS  0000895421  C   0000831001  USB 0000036104  PNC 0000713676
--   BRK 0001067983  BLK 0002012383  AXP 0000004962  SCHW 0000316709
--   COF 0000927628  TFC 0000092230  BK  0001390777  SPGI 0000064040
INSERT INTO ingestion_sources
  (slug, display_name, adapter_type, endpoint, sectors,
   fetch_interval_seconds, quality_score, priority, enabled, config, paired_writer_id)
SELECT
  'sec-edgar-finance',
  'SEC EDGAR (finance CIKs)',
  'sec_edgar_json'::ingestion_adapter_type,
  'https://data.sec.gov/submissions/CIK{cik}.json',
  ARRAY['finance'],
  900,
  9::smallint,
  1,
  true,
  '{"ciks":["0000019617","0000070858","0000072971","0000886982","0000895421","0000831001","0000036104","0000713676","0001067983","0002012383","0000004962","0000316709","0000927628","0000092230","0001390777","0000064040"]}'::jsonb,
  w.id
FROM writers w
WHERE w.name = 'SEC EDGAR (finance CIKs)'
  AND NOT EXISTS (
    SELECT 1 FROM ingestion_sources s WHERE s.slug = 'sec-edgar-finance'
  );--> statement-breakpoint

-- ---- 3. Re-enable the existing Semis EDGAR source ----
UPDATE ingestion_sources
  SET enabled = true,
      updated_at = now()
  WHERE slug = 'sec-edgar-semis'
    AND enabled = false;
