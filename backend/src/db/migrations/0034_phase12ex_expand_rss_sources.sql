-- 0034 — Phase 12e.x: expand the RSS source registry (+12 sources).
--
-- Sibling to 0028 (which disabled 11 dead feeds during the soak). This
-- re-grows the catalog with 12 NEW, individually-probed RSS sources
-- across the three sectors. Every endpoint below was fetched with the
-- SIGNAL ingestion User-Agent and confirmed to:
--   (1) return HTTP 2xx,
--   (2) serve an XML content-type accepted by the RSS adapter
--       (application/rss+xml | application/xml | application/atom+xml |
--        text/xml) — a feed served as text/html is rejected by the
--       adapter (the bug that sank bis-press), so html-only feeds were
--       skipped here, and
--   (3) parse via rss-parser into items that carry real body text
--       (>=50% of items with >=40 chars of content/summary) — title-only
--       or paywalled-to-stub feeds were skipped.
--
-- Skipped probed candidates (recorded for the next pass): Hugging Face
-- Blog (788 items, 0% body — title-only), W&B / Cohere / AnandTech /
-- SEMI.org (served text/html or 403 — adapter would reject), Mistral /
-- Epsilon Theory / Axios Markets / Odd Lots (404/dead), More Than Moore
-- (45% body — under the bar).
--
-- Pattern mirrors 0014 exactly: each source gets a paired `writers` row
-- (writers.name = ingestion_sources.display_name) inserted first under an
-- INSERT ... SELECT ... WHERE NOT EXISTS guard, then the source rows JOIN
-- writers on name to resolve paired_writer_id. priority follows the 0022
-- rubric (1=lab/regulator, 2=analyst newsletter, 3=news/trade, 4=community);
-- all new rows are analyst (2) or news/trade (3). No schema change — these
-- are data rows in the existing shape. Existing rows are untouched.

INSERT INTO writers (name, sectors)
SELECT src.name, src.sectors
FROM (VALUES
  -- AI
  ('Ahead of AI (Sebastian Raschka)',      '["ai"]'::jsonb),
  ('The Gradient',                         '["ai"]'::jsonb),
  ('Latent Space',                         '["ai"]'::jsonb),
  ('AI Snake Oil (Narayanan & Kapoor)',    '["ai"]'::jsonb),
  -- Finance
  ('Doomberg',                             '["finance"]'::jsonb),
  ('Calculated Risk (Bill McBride)',       '["finance"]'::jsonb),
  ('DealBook (NYT)',                       '["finance"]'::jsonb),
  ('FT Alphaville',                        '["finance"]'::jsonb),
  ('Bankless',                             '["finance"]'::jsonb),
  -- Semiconductors
  ('IEEE Spectrum',                        '["semiconductors"]'::jsonb),
  ('Electronic Design',                    '["semiconductors"]'::jsonb),
  ('TechInsights',                         '["semiconductors"]'::jsonb)
) AS src(name, sectors)
WHERE NOT EXISTS (
  SELECT 1 FROM writers existing WHERE existing.name = src.name
);--> statement-breakpoint

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
  -- AI sector (4)
  ('ahead-of-ai',        'Ahead of AI (Sebastian Raschka)',   'rss', 'https://magazine.sebastianraschka.com/feed',                  ARRAY['ai'],             3600, 8::smallint, 2, true),
  ('the-gradient',       'The Gradient',                      'rss', 'https://thegradient.pub/rss/',                                ARRAY['ai'],             3600, 7::smallint, 3, true),
  ('latent-space',       'Latent Space',                      'rss', 'https://www.latent.space/feed',                               ARRAY['ai'],             3600, 8::smallint, 2, true),
  ('ai-snake-oil',       'AI Snake Oil (Narayanan & Kapoor)', 'rss', 'https://www.aisnakeoil.com/feed',                             ARRAY['ai'],             3600, 8::smallint, 2, true),
  -- Finance sector (5)
  ('doomberg',           'Doomberg',                          'rss', 'https://doomberg.substack.com/feed',                          ARRAY['finance'],        3600, 7::smallint, 2, true),
  ('calculated-risk',    'Calculated Risk (Bill McBride)',    'rss', 'https://www.calculatedriskblog.com/feeds/posts/default',      ARRAY['finance'],        3600, 8::smallint, 2, true),
  ('nyt-dealbook',       'DealBook (NYT)',                    'rss', 'https://rss.nytimes.com/services/xml/rss/nyt/Dealbook.xml',   ARRAY['finance'],        3600, 8::smallint, 3, true),
  ('ft-alphaville',      'FT Alphaville',                     'rss', 'https://www.ft.com/alphaville?format=rss',                    ARRAY['finance'],        3600, 8::smallint, 3, true),
  ('bankless',           'Bankless',                          'rss', 'https://www.bankless.com/rss/feed',                           ARRAY['finance'],        3600, 6::smallint, 3, true),
  -- Semiconductors sector (3)
  ('ieee-spectrum',      'IEEE Spectrum',                     'rss', 'https://spectrum.ieee.org/rss/fulltext',                      ARRAY['semiconductors'], 3600, 8::smallint, 3, true),
  ('electronic-design',  'Electronic Design',                 'rss', 'https://www.electronicdesign.com/rss.xml',                    ARRAY['semiconductors'], 3600, 7::smallint, 3, true),
  ('techinsights',       'TechInsights',                      'rss', 'https://www.techinsights.com/rss.xml',                        ARRAY['semiconductors'], 3600, 8::smallint, 2, true)
) AS src(slug, display_name, adapter_type, endpoint, sectors, fetch_interval_seconds, quality_score, priority, enabled)
JOIN writers w ON w.name = src.display_name;
