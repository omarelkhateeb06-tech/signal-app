-- Phase 12k — Open Graph image URLs on stories and events.
-- Two columns added: `stories.image_url` and `events.image_url`. Plain
-- TEXT, nullable.
--
-- Source of truth at write time:
--   - events: extracted from the source HTML during the enrichment body
--     fetch (no extra HTTP request — same fetch that feeds readability).
--     The bodyExtractor reads <meta property="og:image"> and falls back
--     to <meta name="twitter:image">. Persisted on `ingestion_candidates`
--     during the heuristic stage, then carried into `events.image_url`
--     by writeEvent.
--   - stories: hand-curated content from Phase 4.5. Backfilled by
--     `npm run backfill-og-images` (refetches the source URL, runs the
--     same extractor).
--
-- Existing rows are NULL until backfill / next enrichment run. The
-- read-side branch on the frontend renders a thumbnail only when the
-- column is non-null; NULL is the no-image path (no placeholder).

ALTER TABLE "stories" ADD COLUMN IF NOT EXISTS "image_url" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "image_url" text;--> statement-breakpoint
ALTER TABLE "ingestion_candidates" ADD COLUMN IF NOT EXISTS "image_url" text;
