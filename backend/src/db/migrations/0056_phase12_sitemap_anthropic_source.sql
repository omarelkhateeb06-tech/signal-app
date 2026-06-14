-- 0056 — Phase 12 ingestion: move anthropic-news onto the sitemap adapter.
--
-- anthropic-news was seeded in 0014 as an `rss` source pointing at
-- https://www.anthropic.com/news/rss.xml, which 404s (Anthropic never
-- shipped — or later removed — that feed); 0028 disabled the row as dead.
-- Anthropic publishes no usable RSS at all, but DOES expose a standards
-- sitemap.xml listing every /news/ article with a <lastmod>. The 'sitemap'
-- adapter (enum value added in 0055) discovers recent articles there; the
-- body seam then fetches each long-form /news/ page (verified server-rendered
-- text/html, ~90k chars — well past the 500-char body floor that makes RSS
-- bridges and short-form social non-viable).
--
-- This converts ONLY anthropic-news. openai-news, deepmind-blog, and
-- google-research were probed 2026-06-14 and their RSS feeds are LIVE (200) —
-- they stay on `rss` (which carries real titles + summaries; sitemap only has
-- slug-derived titles). The sitemap adapter is the general fallback for any
-- primary whose RSS later dies, but converting a working feed would be a
-- regression (cf. the money-stuff lesson). HuggingFace stays dead for a
-- different reason (title-only body, not missing RSS) — sitemap wouldn't help.
--
-- config:
--   pathPrefix    '/news/' — only article URLs under the news path (the
--                 listing page and non-article URLs are excluded; an entry
--                 needs a non-empty slug after the prefix).
--   lookbackDays  7 — coarse pre-filter; the heuristic seam's 36h recency
--                 cutoff (on publishedAt = <lastmod>) is the real gate, and
--                 the (source, external_id=url) unique constraint dedups
--                 across polls, so re-polling is cheap and idempotent.
-- priority 1 (lab/SEC primary), quality_score left at the seeded 9, hourly
-- poll. Re-enabled. Idempotent: UPDATE keyed on slug.

UPDATE ingestion_sources
SET
  adapter_type = 'sitemap'::ingestion_adapter_type,
  endpoint = 'https://www.anthropic.com/sitemap.xml',
  enabled = true,
  priority = 1,
  fetch_interval_seconds = 3600,
  config = '{"pathPrefix":"/news/","lookbackDays":7}'::jsonb,
  updated_at = now()
WHERE slug = 'anthropic-news';
