-- 0059_phase12_sitemap_og_title.sql
-- Enables og:title fetching for the anthropic-news sitemap source so article
-- titles are extracted from actual page <meta property="og:title"> rather
-- than URL slugs ("Tcs Anthropic Partnership" → real headline).
-- Requires the sitemap adapter's fetchOgTitle opt-in (added in the adapter code).

UPDATE ingestion_sources
SET config = config || '{"fetchOgTitle":true}'::jsonb
WHERE slug = 'anthropic-news';
