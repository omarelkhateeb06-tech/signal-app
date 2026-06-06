-- 0046 — Phase 12R.A (Real-Time Layer): Product Hunt source + 'launch' content type.
--
-- First of the Real-Time Layer breadth sources. Product Hunt surfaces new
-- tool/startup launches; it's a standard RSS feed, so it reuses the existing
-- `rss` adapter — no new adapter code. The feed is classified at write time as
-- content_type='launch' so the feed renders a distinct "THE LAUNCH" card.
--
-- Classification is source-declared, not adapter-hardcoded: the source carries
-- `config.contentType` and writeEvent reads it (falling back to the EDGAR →
-- 'filing' rule). This keeps the mechanism general — a future X source can
-- declare config.contentType='take' the same way, no writeEvent change needed.
--
-- Each step is guarded so re-applying is a clean no-op.

-- ---- 1. Allow 'launch' in the content_type CHECK (drop + re-add, idempotent) ----
ALTER TABLE "events" DROP CONSTRAINT IF EXISTS "events_content_type_check";--> statement-breakpoint
ALTER TABLE "events"
  ADD CONSTRAINT "events_content_type_check"
  CHECK ("content_type" IS NULL OR "content_type" IN ('filing', 'general', 'launch'));--> statement-breakpoint

-- ---- 2. Product Hunt RSS source ----
-- Tagged AI (the highest-signal launch slice for SIGNAL's audience; the LLM
-- relevance gate filters the rest). adapter_type='rss' — reuses the RSS
-- adapter. config.contentType='launch' drives the card classification.
-- priority 3 (news/default tier), quality_score 6, poll every 4h.
INSERT INTO ingestion_sources
  (slug, display_name, adapter_type, endpoint, sectors,
   fetch_interval_seconds, quality_score, priority, enabled, config)
SELECT
  'producthunt',
  'Product Hunt',
  'rss'::ingestion_adapter_type,
  'https://www.producthunt.com/feed',
  ARRAY['ai'],
  14400,
  6::smallint,
  3,
  true,
  '{"contentType":"launch"}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM ingestion_sources s WHERE s.slug = 'producthunt'
);
