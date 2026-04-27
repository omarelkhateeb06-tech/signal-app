-- 0014 — Phase 12e.1: ingestion_sources table + 42-source registry seed.
--
-- Introduces the catalog of curated content sources that downstream
-- ingestion workers (12e.2 onward) poll into ingestion_candidates and
-- ultimately into events. Schema and source list match
-- docs/roadmap/SIGNAL-roadmap.md §5.4 and §5.4.S.
--
-- Each source row gets a paired `writers` row (writers.name =
-- ingestion_sources.display_name) inserted in the same migration so feed
-- bylines reflect source provenance ("SemiAnalysis", "OpenAI News")
-- rather than a synthetic SIGNAL Wire byline. The pairing is enforced by
-- ingestion_sources.paired_writer_id ON DELETE SET NULL — deleting a
-- writer leaves the source row intact and unowned, surfaceable by the
-- 12e.8 admin status route.
--
-- The FRED row is seeded with enabled=false; adapter implementation is
-- deferred per roadmap §13. endpoint is nullable specifically so the
-- FRED row can land without a placeholder URL.

-- Adapter-type enum. Five values matching the five adapter
-- implementations across 12e.2 / 12e.5d / 12e.5e.
CREATE TYPE ingestion_adapter_type AS ENUM (
  'rss',
  'arxiv_atom',
  'sec_edgar_json',
  'hackernews_api',
  'reddit_api'
);--> statement-breakpoint

CREATE TABLE ingestion_sources (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                    text NOT NULL UNIQUE,
  display_name            text NOT NULL,
  adapter_type            ingestion_adapter_type NOT NULL,
  endpoint                text,
  sectors                 text[] NOT NULL,
  fetch_interval_seconds  integer NOT NULL DEFAULT 1800,
  quality_score           smallint NOT NULL DEFAULT 5
                          CHECK (quality_score BETWEEN 1 AND 10),
  enabled                 boolean NOT NULL DEFAULT true,
  paired_writer_id        uuid REFERENCES writers(id) ON DELETE SET NULL,
  config                  jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_polled_at          timestamptz,
  consecutive_failure_count integer NOT NULL DEFAULT 0,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE INDEX ingestion_sources_enabled_interval_idx
  ON ingestion_sources (enabled, fetch_interval_seconds);--> statement-breakpoint

-- Seed: 42 paired (writer, source) rows.
--
-- Pattern: INSERT ... SELECT ... WHERE NOT EXISTS guards the writers
-- step against name collisions. `writers.name` is not UNIQUE in the
-- schema (matches existing seedStories.ts behavior — SELECT-by-name,
-- INSERT-if-absent), so a future seed or partial replay that already
-- created a writer with one of these 42 names would, without the
-- guard, double-insert. The runner's transactional file-per-migration
-- behavior already protects against partial-failure rollback within a
-- single run; this guard adds defense for cross-migration overlap. On
-- a clean DB, all 42 rows insert; on a DB where any subset already
-- exists, only the missing rows insert.
--
-- The downstream INSERT into ingestion_sources joins on
-- writers.name to resolve paired_writer_id. None of the 42 names
-- collide with each other or with the existing "SIGNAL Editorial"
-- writer, so the join remains unambiguous regardless of which subset
-- this statement actually inserted.

INSERT INTO writers (name, sectors)
SELECT src.name, src.sectors
FROM (VALUES
  ('Anthropic News',                       '["ai"]'::jsonb),
  ('OpenAI News',                          '["ai"]'::jsonb),
  ('Google DeepMind Blog',                 '["ai"]'::jsonb),
  ('Google Research Blog',                 '["ai"]'::jsonb),
  ('Meta AI Blog',                         '["ai"]'::jsonb),
  ('arXiv cs.AI + cs.CL + cs.LG',          '["ai"]'::jsonb),
  ('Hugging Face Daily Papers',            '["ai"]'::jsonb),
  ('Import AI (Jack Clark)',               '["ai"]'::jsonb),
  ('Interconnects (Nathan Lambert)',       '["ai"]'::jsonb),
  ('Simon Willison''s Weblog',             '["ai"]'::jsonb),
  ('The Batch (DeepLearning.AI)',          '["ai"]'::jsonb),
  ('MIT Technology Review AI',             '["ai"]'::jsonb),
  ('Ars Technica AI/ML',                   '["ai"]'::jsonb),
  ('Hacker News (filtered)',               '["ai"]'::jsonb),
  ('NVIDIA Newsroom',                      '["semiconductors"]'::jsonb),
  ('AMD Newsroom',                         '["semiconductors"]'::jsonb),
  ('TSMC Newsroom',                        '["semiconductors"]'::jsonb),
  ('ASML News',                            '["semiconductors"]'::jsonb),
  ('Intel Newsroom',                       '["semiconductors"]'::jsonb),
  ('EE Times',                             '["semiconductors"]'::jsonb),
  ('Semiconductor Engineering',            '["semiconductors"]'::jsonb),
  ('ServeTheHome',                         '["semiconductors"]'::jsonb),
  ('SemiAnalysis (Dylan Patel)',           '["semiconductors"]'::jsonb),
  ('Fabricated Knowledge',                 '["semiconductors"]'::jsonb),
  ('Asianometry',                          '["semiconductors"]'::jsonb),
  ('BIS Press Releases',                   '["semiconductors"]'::jsonb),
  ('SEC EDGAR (semis CIKs)',               '["semiconductors"]'::jsonb),
  ('Reuters Business',                     '["finance"]'::jsonb),
  ('CNBC Markets',                         '["finance"]'::jsonb),
  ('Bloomberg Markets (headlines)',        '["finance"]'::jsonb),
  ('MarketWatch',                          '["finance"]'::jsonb),
  ('SEC EDGAR (full feed)',                '["finance"]'::jsonb),
  ('Federal Reserve Press Releases',       '["finance"]'::jsonb),
  ('BLS Press Releases',                   '["finance"]'::jsonb),
  ('Money Stuff (Matt Levine)',            '["finance"]'::jsonb),
  ('The Diff (Byrne Hobart)',              '["finance"]'::jsonb),
  ('Net Interest (Marc Rubinstein)',       '["finance"]'::jsonb),
  ('Apricitas Economics',                  '["finance"]'::jsonb),
  ('Marginal Revolution',                  '["finance"]'::jsonb),
  ('Stratechery (free tier)',              '["finance"]'::jsonb),
  ('Reddit r/SecurityAnalysis + r/investing', '["finance"]'::jsonb),
  ('FRED API',                             '["finance"]'::jsonb)
) AS src(name, sectors)
WHERE NOT EXISTS (
  SELECT 1 FROM writers existing WHERE existing.name = src.name
);--> statement-breakpoint

INSERT INTO ingestion_sources
  (slug, display_name, adapter_type, endpoint, sectors,
   fetch_interval_seconds, quality_score, enabled, paired_writer_id)
SELECT
  src.slug,
  src.display_name,
  src.adapter_type::ingestion_adapter_type,
  src.endpoint,
  src.sectors,
  src.fetch_interval_seconds,
  src.quality_score,
  src.enabled,
  w.id
FROM (VALUES
  -- AI sector (14)
  ('anthropic-news',      'Anthropic News',                       'rss',            'https://www.anthropic.com/news/rss.xml',                                                                                              ARRAY['ai'],              3600,  9::smallint, true),
  ('openai-news',         'OpenAI News',                          'rss',            'https://openai.com/news/rss.xml',                                                                                                     ARRAY['ai'],              3600,  9::smallint, true),
  ('deepmind-blog',       'Google DeepMind Blog',                 'rss',            'https://deepmind.google/blog/rss.xml',                                                                                                ARRAY['ai'],              3600,  9::smallint, true),
  ('google-research',     'Google Research Blog',                 'rss',            'https://research.google/blog/rss/',                                                                                                   ARRAY['ai'],              3600,  8::smallint, true),
  ('meta-ai-blog',        'Meta AI Blog',                         'rss',            'https://ai.meta.com/blog/rss/',                                                                                                       ARRAY['ai'],              3600,  8::smallint, true),
  ('arxiv-ai-cl-lg',      'arXiv cs.AI + cs.CL + cs.LG',          'arxiv_atom',     'https://export.arxiv.org/api/query?search_query=cat:cs.AI+OR+cat:cs.CL+OR+cat:cs.LG&sortBy=submittedDate&sortOrder=descending',      ARRAY['ai'],             86400,  9::smallint, true),
  ('huggingface-papers',  'Hugging Face Daily Papers',            'rss',            'https://huggingface.co/papers/rss',                                                                                                   ARRAY['ai'],              3600,  8::smallint, true),
  ('import-ai',           'Import AI (Jack Clark)',               'rss',            'https://importai.substack.com/feed',                                                                                                  ARRAY['ai'],              3600,  9::smallint, true),
  ('interconnects',       'Interconnects (Nathan Lambert)',       'rss',            'https://www.interconnects.ai/feed',                                                                                                   ARRAY['ai'],              3600,  9::smallint, true),
  ('simonwillison',       'Simon Willison''s Weblog',             'rss',            'https://simonwillison.net/atom/everything/',                                                                                          ARRAY['ai'],              3600,  9::smallint, true),
  ('the-batch',           'The Batch (DeepLearning.AI)',          'rss',            'https://www.deeplearning.ai/the-batch/feed/',                                                                                         ARRAY['ai'],              3600,  7::smallint, true),
  ('mit-tech-review-ai',  'MIT Technology Review AI',             'rss',            'https://www.technologyreview.com/topic/artificial-intelligence/feed',                                                                 ARRAY['ai'],              3600,  7::smallint, true),
  ('arstechnica-ai',      'Ars Technica AI/ML',                   'rss',            'https://arstechnica.com/ai/feed/',                                                                                                    ARRAY['ai'],              3600,  7::smallint, true),
  ('hackernews',          'Hacker News (filtered)',               'hackernews_api', 'https://hacker-news.firebaseio.com/v0/topstories.json',                                                                               ARRAY['ai'],             14400,  6::smallint, true),
  -- Semiconductors sector (13)
  ('nvidia-newsroom',     'NVIDIA Newsroom',                      'rss',            'https://nvidianews.nvidia.com/releases.xml',                                                                                          ARRAY['semiconductors'],  3600,  9::smallint, true),
  ('amd-newsroom',        'AMD Newsroom',                         'rss',            'https://www.amd.com/en/newsroom/news-releases.xml',                                                                                   ARRAY['semiconductors'],  3600,  9::smallint, true),
  ('tsmc-newsroom',       'TSMC Newsroom',                        'rss',            'https://pr.tsmc.com/english/news.xml',                                                                                                ARRAY['semiconductors'],  3600,  9::smallint, true),
  ('asml-news',           'ASML News',                            'rss',            'https://www.asml.com/en/news/rss',                                                                                                    ARRAY['semiconductors'],  3600,  9::smallint, true),
  ('intel-newsroom',      'Intel Newsroom',                       'rss',            'https://www.intel.com/content/www/us/en/newsroom/news.xml',                                                                           ARRAY['semiconductors'],  3600,  8::smallint, true),
  ('ee-times',            'EE Times',                             'rss',            'https://www.eetimes.com/feed/',                                                                                                       ARRAY['semiconductors'],  3600,  7::smallint, true),
  ('semi-engineering',    'Semiconductor Engineering',            'rss',            'https://semiengineering.com/feed/',                                                                                                   ARRAY['semiconductors'],  3600,  7::smallint, true),
  ('servethehome',        'ServeTheHome',                         'rss',            'https://www.servethehome.com/feed/',                                                                                                  ARRAY['semiconductors'],  3600,  7::smallint, true),
  ('semianalysis',        'SemiAnalysis (Dylan Patel)',           'rss',            'https://semianalysis.substack.com/feed',                                                                                              ARRAY['semiconductors'],  3600,  9::smallint, true),
  ('fabricated-knowledge','Fabricated Knowledge',                 'rss',            'https://www.fabricatedknowledge.com/feed',                                                                                            ARRAY['semiconductors'],  3600,  8::smallint, true),
  ('asianometry',         'Asianometry',                          'rss',            'https://asianometry.substack.com/feed',                                                                                               ARRAY['semiconductors'],  3600,  7::smallint, true),
  ('bis-press',           'BIS Press Releases',                   'rss',            'https://www.bis.doc.gov/index.php?format=feed&type=rss',                                                                              ARRAY['semiconductors'],  3600,  8::smallint, true),
  ('sec-edgar-semis',     'SEC EDGAR (semis CIKs)',               'sec_edgar_json', 'https://data.sec.gov/submissions/CIK{cik}.json',                                                                                      ARRAY['semiconductors'],   900,  9::smallint, true),
  -- Finance sector (15)
  ('reuters-business',    'Reuters Business',                     'rss',            'https://www.reuters.com/business/feed',                                                                                               ARRAY['finance'],         3600,  9::smallint, true),
  ('cnbc-markets',        'CNBC Markets',                         'rss',            'https://www.cnbc.com/id/15839135/device/rss/rss.html',                                                                                ARRAY['finance'],         3600,  7::smallint, true),
  ('bloomberg-markets',   'Bloomberg Markets (headlines)',        'rss',            'https://feeds.bloomberg.com/markets/news.rss',                                                                                        ARRAY['finance'],         3600,  7::smallint, true),
  ('marketwatch',         'MarketWatch',                          'rss',            'https://feeds.marketwatch.com/marketwatch/topstories/',                                                                               ARRAY['finance'],         3600,  6::smallint, true),
  ('sec-edgar-full',      'SEC EDGAR (full feed)',                'sec_edgar_json', 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&output=atom',                                                              ARRAY['finance'],          900,  9::smallint, true),
  ('fed-press',           'Federal Reserve Press Releases',       'rss',            'https://www.federalreserve.gov/feeds/press_all.xml',                                                                                  ARRAY['finance'],         3600,  9::smallint, true),
  ('bls-press',           'BLS Press Releases',                   'rss',            'https://www.bls.gov/feed/bls_latest.rss',                                                                                             ARRAY['finance'],         3600,  8::smallint, true),
  ('money-stuff',         'Money Stuff (Matt Levine)',            'rss',            'https://www.bloomberg.com/feeds/money-stuff/sitemap_news.xml',                                                                        ARRAY['finance'],         3600,  9::smallint, true),
  ('the-diff',            'The Diff (Byrne Hobart)',              'rss',            'https://www.thediff.co/feed',                                                                                                         ARRAY['finance'],         3600,  8::smallint, true),
  ('net-interest',        'Net Interest (Marc Rubinstein)',       'rss',            'https://www.netinterest.co/feed',                                                                                                     ARRAY['finance'],         3600,  8::smallint, true),
  ('apricitas',           'Apricitas Economics',                  'rss',            'https://www.apricitas.io/feed',                                                                                                       ARRAY['finance'],         3600,  8::smallint, true),
  ('marginal-revolution', 'Marginal Revolution',                  'rss',            'https://marginalrevolution.com/feed',                                                                                                 ARRAY['finance'],         3600,  7::smallint, true),
  ('stratechery-free',    'Stratechery (free tier)',              'rss',            'https://stratechery.com/feed/',                                                                                                       ARRAY['finance'],         3600,  8::smallint, true),
  ('reddit-finance',      'Reddit r/SecurityAnalysis + r/investing', 'reddit_api',  'r/SecurityAnalysis+investing/top.json?t=day',                                                                                         ARRAY['finance'],        14400,  5::smallint, true),
  -- FRED row: enabled=false, endpoint=NULL, adapter_type=rss as a placeholder
  -- (the actual adapter is unimplemented). quality_score uses the schema
  -- DEFAULT 5; revisit at 12e-post-launch FRED integration phase.
  ('fred-api',            'FRED API',                             'rss',            NULL,                                                                                                                                  ARRAY['finance'],         3600,  5::smallint, false)
) AS src(slug, display_name, adapter_type, endpoint, sectors, fetch_interval_seconds, quality_score, enabled)
JOIN writers w ON w.name = src.display_name;
