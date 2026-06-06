-- 0048 — Phase 12R.A: 'tool' content type + GitHub AI source.
--
-- GitHub repos are classified content_type='tool' so the feed renders them as
-- the existing WORTH AN AFTERNOON card (shared with the native tool-spotlight).
-- Seeds one AI-focused GitHub source (more sectors can be added by inserting
-- more rows with different topics). Uses the 'github_api' enum value added in
-- 0047. Each step guarded so re-applying is a clean no-op.

-- ---- 1. Allow 'tool' in the content_type CHECK (drop + re-add, idempotent) ----
ALTER TABLE "events" DROP CONSTRAINT IF EXISTS "events_content_type_check";--> statement-breakpoint
ALTER TABLE "events"
  ADD CONSTRAINT "events_content_type_check"
  CHECK ("content_type" IS NULL OR "content_type" IN ('filing', 'general', 'launch', 'tool'));--> statement-breakpoint

-- ---- 2. GitHub AI source ----
-- adapter_type='github_api'; config carries the topic list + signal floor +
-- window, and contentType='tool' (writeEvent reads it → WORTH AN AFTERNOON
-- card). priority 3, quality_score 6, poll every 6h.
INSERT INTO ingestion_sources
  (slug, display_name, adapter_type, endpoint, sectors,
   fetch_interval_seconds, quality_score, priority, enabled, config)
SELECT
  'github-ai',
  'GitHub',
  'github_api'::ingestion_adapter_type,
  'https://api.github.com/search/repositories',
  ARRAY['ai'],
  21600,
  6::smallint,
  3,
  true,
  '{"contentType":"tool","minStars":150,"windowDays":60,"maxRepos":20,"topics":["llm","ai-agents","rag","inference","agents","mcp"]}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM ingestion_sources s WHERE s.slug = 'github-ai'
);
