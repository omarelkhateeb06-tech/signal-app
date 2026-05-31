-- 0041 — Phase 12n.4: RSS source expansion, semiconductors-priority (+6 new).
--
-- Follow-up to 0034/0035. Data-only (no schema change). Seeds 6 NEW probed
-- RSS sources: 4 semiconductors (the thinnest sector, ~7 events/day) + 2
-- analyst-grade finance supplements. Goal is to lift total ingest toward
-- 50-100 events/day with semis as the primary target.
--
-- Every endpoint below was probed adapter-faithfully (same method as
-- 0034/0035): SIGNAL ingestion User-Agent, HTTP 2xx (redirects followed by
-- the adapter's default fetch), an XML content-type the RSS adapter accepts
-- (application/rss+xml | application/xml | text/xml | application/atom+xml),
-- and rss-parser items with real body text. Probe date 2026-05-31; every
-- feed carried an item dated within the prior ~8 days.
--
-- Endpoints stored as their resolved final URL where the probed path 301/302'd
-- (tomshardware /feeds/all -> /feeds.xml; chips-and-cheese /feed/ -> /feed) so
-- the poller skips the redirect hop. nextplatform keeps /feed/ (its resolved
-- URL is a non-canonical viewport variant; the adapter follows the redirect).
--
-- Skipped candidates (recorded for the next pass):
--   Semis — arm-newsroom, synopsys-blog, qualcomm, micron-insight (404);
--           anandtech (site shut down 2025, redirects to forums HTML);
--           wikichip (no connection); cadence-blog (503 bot-block).
--   AI    — wandb-blog, cohere-blog (served text/html — adapter rejects);
--           allen-ai, mistral-blog (404). No valid AI add this pass.
--   Finance — odd-lots (403, and a podcast feed not article RSS).
--
-- Pattern mirrors 0034/0035: paired `writers` rows first under a NOT EXISTS
-- guard, then source rows JOIN writers on name. priority per the 0022 rubric
-- (2=analyst/flagship, 3=news/trade). Existing healthy rows are untouched.

-- ---- Part 1: paired writers for the 6 new sources ----
INSERT INTO writers (name, sectors)
SELECT src.name, src.sectors
FROM (VALUES
  -- Semiconductors
  ('The Next Platform',  '["semiconductors"]'::jsonb),
  ('Chips and Cheese',   '["semiconductors"]'::jsonb),
  ('Tom''s Hardware',    '["semiconductors"]'::jsonb),
  ('Hackaday',           '["semiconductors"]'::jsonb),
  -- Finance
  ('Econbrowser',        '["finance"]'::jsonb),
  ('Alpha Architect',    '["finance"]'::jsonb)
) AS src(name, sectors)
WHERE NOT EXISTS (
  SELECT 1 FROM writers existing WHERE existing.name = src.name
);--> statement-breakpoint

-- ---- Part 1: the 6 new source rows ----
INSERT INTO ingestion_sources
  (slug, display_name, adapter_type, endpoint, sectors,
   fetch_interval_seconds, quality_score, priority, enabled, paired_writer_id)
SELECT
  src.slug,
  src.display_name,
  src.adapter_type::ingestion_adapter_type,
  src.endpoint,
  src.sectors,
  src.fetch_interval_seconds,
  src.quality_score,
  src.priority,
  src.enabled,
  w.id
FROM (VALUES
  -- Semiconductors sector (4) — the priority target
  ('nextplatform',     'The Next Platform', 'rss', 'https://www.nextplatform.com/feed/',  ARRAY['semiconductors'], 1800, 8::smallint, 2, true),
  ('chips-and-cheese', 'Chips and Cheese',  'rss', 'https://chipsandcheese.com/feed',     ARRAY['semiconductors'], 7200, 8::smallint, 2, true),
  ('tomshardware',     'Tom''s Hardware',   'rss', 'https://www.tomshardware.com/feeds.xml', ARRAY['semiconductors'], 1800, 7::smallint, 3, true),
  ('hackaday',         'Hackaday',          'rss', 'https://hackaday.com/blog/feed/',     ARRAY['semiconductors'], 1800, 6::smallint, 3, true),
  -- Finance sector (2) — analyst-grade supplements
  ('econbrowser',      'Econbrowser',       'rss', 'https://econbrowser.com/feed',        ARRAY['finance'],        7200, 7::smallint, 2, true),
  ('alphaarchitect',   'Alpha Architect',   'rss', 'https://alphaarchitect.com/feed/',    ARRAY['finance'],        7200, 7::smallint, 2, true)
) AS src(slug, display_name, adapter_type, endpoint, sectors, fetch_interval_seconds, quality_score, priority, enabled)
JOIN writers w ON w.name = src.display_name;
