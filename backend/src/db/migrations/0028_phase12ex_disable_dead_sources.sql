-- Phase 12e.x — disable 11 ingestion sources that hit 63 consecutive
-- failures with last_success_at IS NULL during the 12h soak.
--
-- Each was probed individually with the SIGNAL User-Agent. Findings:
--   amd-newsroom        — 15s timeout, bot-blocked (no response).
--   anthropic-news      — 404 on /news/rss.xml (no RSS endpoint).
--   asml-news           — 404 on /en/news/rss (no RSS endpoint).
--   bis-press           — 200 but Content-Type text/html (no RSS at the URL).
--   huggingface-papers  — 401 unauthorized (auth-required).
--   intel-newsroom      — 404 on /content/www/us/en/newsroom/news.xml.
--   meta-ai-blog        — 404 on ai.meta.com/blog/rss/.
--   money-stuff         — 404 on bloomberg.com/feeds/money-stuff/* (now subscriber-only).
--   reuters-business    — 401 unauthorized.
--   the-batch           — 404 on deeplearning.ai/the-batch/feed/.
--   tsmc-newsroom       — 404 on pr.tsmc.com/english/news.xml.
--
-- A handful of obvious alternate URL shapes (feed.xml, /blog/rss, etc.)
-- were also probed and returned 404. Re-enable any of these in a
-- follow-up migration once a working endpoint is confirmed; until
-- then, disabled keeps them out of the poll loop and out of the
-- failing-source noise on the admin status route.

UPDATE ingestion_sources
  SET enabled = false,
      updated_at = now()
  WHERE slug IN (
    'amd-newsroom',
    'anthropic-news',
    'asml-news',
    'bis-press',
    'huggingface-papers',
    'intel-newsroom',
    'meta-ai-blog',
    'money-stuff',
    'reuters-business',
    'the-batch',
    'tsmc-newsroom'
  );
