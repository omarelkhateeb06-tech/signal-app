-- 0053 — Phase 12 ingestion Tier 1: activate the FRED macro-data source.
--
-- The fred-api row has existed since 0014 as a disabled placeholder
-- (adapter_type='rss', endpoint NULL, quality_score left at the DEFAULT 5
-- with a "revisit at the FRED integration phase" note — which is this
-- migration). Repoint it at the real 'fred_api' adapter (enum value added
-- in 0052), enable it, and price it:
--
--   priority 2       authoritative primary data, analyst grade (0022 scale:
--                    1=lab/SEC, 2=analyst, 3=news, 4=community). 0022 left
--                    fred-api at the default 3 "to be repriced if/when
--                    re-enabled" — that's now.
--   quality_score 8  official Fed/BLS/Treasury statistics; on par with the
--                    top analyst feeds (money-stuff 9, the-diff 8), above
--                    sec-form-d (7) since each reading is market-moving
--                    macro data rather than a single private filing.
--
-- config knobs (read by the adapter; tuning is a data change, not code):
--   contentType   'filing' — feed renders these as the EARNINGS/SEC data
--                 card (read by writeEvent.classifyContentType)
--   seriesIds     FEDFUNDS (fed funds rate), CPIAUCSL (CPI), DGS10
--                 (10-year Treasury), UNRATE (unemployment), PCEPI (PCE)
--   lookbackDays  45 — max age of a series' last_updated before its latest
--                 reading is treated as stale and skipped. Deliberately NOT
--                 the 14 the planning doc sketched: monthly series (CPI/PCE/
--                 UNRATE) publish ~2-6 weeks after the observation period,
--                 so a 14-day bound would drop a perfectly current reading
--                 for most of each month's cycle.
--
-- fetch_interval_seconds stays at the seeded 3600 — hourly polling catches
-- an 8:30am ET release within the hour, and re-polls are dedup-dropped at
-- the candidate layer, so the only cost is ~10 FRED calls/hour (limit:
-- 120/min). The adapter requires FRED_API_KEY (free key:
-- https://fred.stlouisfed.org/docs/api/api_key.html) and logs-and-skips
-- when unset, so enabling the row before the key lands in Railway is safe.
-- Idempotent: an UPDATE keyed on slug.

UPDATE ingestion_sources
SET
  adapter_type = 'fred_api'::ingestion_adapter_type,
  endpoint = 'https://api.stlouisfed.org/fred',
  enabled = true,
  priority = 2,
  quality_score = 8::smallint,
  config = '{"contentType":"filing","seriesIds":["FEDFUNDS","CPIAUCSL","DGS10","UNRATE","PCEPI"],"lookbackDays":45}'::jsonb,
  updated_at = now()
WHERE slug = 'fred-api';
