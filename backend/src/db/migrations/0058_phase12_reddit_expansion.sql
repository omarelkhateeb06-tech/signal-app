-- 0058_phase12_reddit_expansion.sql
-- Adds ingestion_sources rows for Reddit AI Research and Semiconductors subreddits.
-- The reddit_api adapter and ingestionAdapterTypeEnum value already exist (migration 0057).
-- ON CONFLICT DO NOTHING makes this idempotent on re-run.

INSERT INTO ingestion_sources (slug, name, adapter_type, endpoint, enabled, priority, quality_score, fetch_interval_seconds, config)
VALUES
  ('reddit-ai',
   'Reddit – AI Research',
   'reddit_api',
   NULL,
   true,
   3,
   7,
   86400,
   '{"subreddits":["MachineLearning","LocalLLaMA"],"minScore":200,"limitPerSub":15}'::jsonb),
  ('reddit-semis',
   'Reddit – Semiconductors',
   'reddit_api',
   NULL,
   true,
   3,
   7,
   86400,
   '{"subreddits":["chipdesign","ASML"],"minScore":50,"limitPerSub":15}'::jsonb)
ON CONFLICT (slug) DO NOTHING;
