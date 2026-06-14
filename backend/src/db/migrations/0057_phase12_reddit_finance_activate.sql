-- 0057 — Phase 12 ingestion: activate the reddit-finance source.
--
-- reddit-finance was seeded in 0014 (adapter_type='reddit_api', endpoint
-- 'r/SecurityAnalysis+investing/top.json?t=day') but the adapter was a stub
-- that threw "not yet implemented", so every poll failed. The real reddit_api
-- adapter now ships (OAuth client-credentials → top-of-day per subreddit),
-- so this row can be activated.
--
-- No enum migration: 'reddit_api' has been a valid ingestion_adapter_type
-- value since 0014 — single-file change.
--
-- Changes:
--   - endpoint → NULL. The adapter reads its subreddit list from config (the
--     single source of truth); the old path-style endpoint is dead.
--   - config → { subreddits, minScore, limitPerSub }. Tuning is a data change.
--     SecurityAnalysis + investing are the long-form-DD finance subs; the body
--     seam's 500-char floor keeps only substantive self-posts + extractable
--     link posts. minScore 100 = real community traction.
--   - enabled → true. The adapter returns [] (a clean, successful empty poll)
--     when REDDIT_CLIENT_ID/SECRET are unset, so enabling ahead of the creds
--     landing in Railway is safe — no more failing polls from the old stub.
--   - fetch_interval_seconds → 14400 (4h, as seeded). priority stays 4
--     (community — never outranks a lab/SEC primary on a cluster match).
--
-- Scope: this activates only the FINANCE subreddits, honoring the slug. The
-- reddit_api adapter is fully config-driven, so AI / semiconductor subreddit
-- coverage is a follow-up row INSERT (e.g. 'reddit-ai' → r/MachineLearning),
-- not a code change — deferred until the subs are vetted for signal quality
-- (r/hardware, the obvious semis candidate, skews consumer-GPU noise).
--
-- Idempotent: UPDATE keyed on slug.

UPDATE ingestion_sources
SET
  endpoint = NULL,
  enabled = true,
  config = '{"subreddits":["SecurityAnalysis","investing"],"minScore":100,"limitPerSub":25}'::jsonb,
  fetch_interval_seconds = 14400,
  updated_at = now()
WHERE slug = 'reddit-finance';
