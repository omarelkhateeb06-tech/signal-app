-- 0035 — Phase 12e.x: RSS source expansion round 2 (+10 new, +2 re-homed).
--
-- Follow-up to 0034. Two parts, both data-only (no schema change):
--
--   Part 1 — seed 10 NEW probed RSS sources (3 AI, 4 Finance, 3 Semis).
--   Part 2 — re-home 2 of the 11 feeds 0028 disabled, by pointing them at
--            a current working endpoint and re-enabling them.
--
-- Every endpoint below was probed adapter-faithfully (same method as
-- 0034): SIGNAL ingestion User-Agent, HTTP 2xx, an XML content-type the
-- RSS adapter accepts, and rss-parser items with real body text (>=50%
-- of items carrying >=40 chars of content/summary). Title-only and
-- paywalled-to-stub feeds were skipped.
--
-- Skipped NEW candidates (recorded for the next pass): Ben's Bites (20%
-- body — truncated), TLDR AI (0% body — title/link only), Stanford HAI /
-- Compounding Quality / Objective Analysis (served text/html or 403 —
-- adapter rejects), Financials Unshackled (dead).
--
-- 0028 feeds that STAY dead (no working RSS endpoint found this pass):
-- anthropic-news, huggingface-papers, meta-ai-blog, the-batch,
-- reuters-business (all 404/401 — no public RSS), amd-newsroom (IR feed
-- is title-only, 0% body), asml-news, bis-press (404/html), tsmc-newsroom
-- (403 bot-block). EDGAR (sec-edgar-*) and fred-api are out of scope here
-- (non-RSS / deferred adapter).
--
-- Notes on two re-homes:
--   money-stuff   -> Matt Levine's Bloomberg Opinion author RSS, which
--                    carries full column text (100% body in probe).
--   intel-newsroom-> Intel's WordPress newsroom feed at /feed/ (the old
--                    /content/.../news.xml path 404s).
--
-- Pattern mirrors 0034: paired `writers` rows first under a NOT EXISTS
-- guard, then the source rows JOIN writers on name. priority per the 0022
-- rubric (2=analyst, 3=news/trade, 4=community/high-volume). Morning Brew
-- is high-volume general-business, so it lands at priority 4 with a 4h
-- fetch interval (matching the community-tier cadence) to bound poll noise.
-- Existing healthy rows are untouched.

-- ---- Part 1: paired writers for the 10 new sources ----
INSERT INTO writers (name, sectors)
SELECT src.name, src.sectors
FROM (VALUES
  -- AI
  ('One Useful Thing (Ethan Mollick)',     '["ai"]'::jsonb),
  ('Lilian Weng',                          '["ai"]'::jsonb),
  ('Big Technology (Alex Kantrowitz)',     '["ai"]'::jsonb),
  -- Finance
  ('The Daily Upside',                     '["finance"]'::jsonb),
  ('Citrini Research',                     '["finance"]'::jsonb),
  ('Bank (Substack)',                      '["finance"]'::jsonb),
  ('Morning Brew',                         '["finance"]'::jsonb),
  -- Semiconductors
  ('EDN',                                  '["semiconductors"]'::jsonb),
  ('DIGITIMES',                            '["semiconductors"]'::jsonb),
  ('SemiWiki',                             '["semiconductors"]'::jsonb)
) AS src(name, sectors)
WHERE NOT EXISTS (
  SELECT 1 FROM writers existing WHERE existing.name = src.name
);--> statement-breakpoint

-- ---- Part 1: the 10 new source rows ----
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
  -- AI sector (3)
  ('one-useful-thing',  'One Useful Thing (Ethan Mollick)',  'rss', 'https://www.oneusefulthing.org/feed',          ARRAY['ai'],              3600, 8::smallint, 2, true),
  ('lilian-weng',       'Lilian Weng',                       'rss', 'https://lilianweng.github.io/index.xml',       ARRAY['ai'],              3600, 8::smallint, 2, true),
  ('big-technology',    'Big Technology (Alex Kantrowitz)',  'rss', 'https://www.bigtechnology.com/feed',           ARRAY['ai'],              3600, 7::smallint, 2, true),
  -- Finance sector (4)
  ('daily-upside',      'The Daily Upside',                  'rss', 'https://www.thedailyupside.com/feed/',         ARRAY['finance'],         3600, 7::smallint, 3, true),
  ('citrini',           'Citrini Research',                  'rss', 'https://www.citriniresearch.com/feed',         ARRAY['finance'],         3600, 7::smallint, 2, true),
  ('bank-substack',     'Bank (Substack)',                   'rss', 'https://bank.substack.com/feed',               ARRAY['finance'],         3600, 6::smallint, 2, true),
  ('morning-brew',      'Morning Brew',                      'rss', 'https://www.morningbrew.com/feed',            ARRAY['finance'],        14400, 5::smallint, 4, true),
  -- Semiconductors sector (3)
  ('edn',               'EDN',                               'rss', 'https://www.edn.com/feed/',                    ARRAY['semiconductors'],  3600, 7::smallint, 3, true),
  ('digitimes',         'DIGITIMES',                         'rss', 'https://www.digitimes.com/rss/daily.xml',      ARRAY['semiconductors'],  3600, 7::smallint, 2, true),
  ('semiwiki',          'SemiWiki',                          'rss', 'https://semiwiki.com/feed/',                   ARRAY['semiconductors'],  3600, 7::smallint, 3, true)
) AS src(slug, display_name, adapter_type, endpoint, sectors, fetch_interval_seconds, quality_score, priority, enabled)
JOIN writers w ON w.name = src.display_name;--> statement-breakpoint

-- ---- Part 2: re-home 2 disabled feeds at working endpoints ----
-- Reset consecutive_failure_count (was 663 from the 0028-era soak) so the
-- admin status route reflects a fresh start on the new URL.
UPDATE ingestion_sources
  SET endpoint = 'https://www.bloomberg.com/opinion/authors/ARbTQlRLRjE/matthew-s-levine.rss',
      enabled = true,
      consecutive_failure_count = 0,
      updated_at = now()
  WHERE slug = 'money-stuff';--> statement-breakpoint

UPDATE ingestion_sources
  SET endpoint = 'https://newsroom.intel.com/feed/',
      enabled = true,
      consecutive_failure_count = 0,
      updated_at = now()
  WHERE slug = 'intel-newsroom';
