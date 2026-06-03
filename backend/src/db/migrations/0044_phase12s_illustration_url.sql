-- Phase 12s — editorial illustration URLs on native events.
--
-- Native (SIGNAL-authored) posts carry no scraped og:image. This column
-- holds an AI-generated editorial illustration (produced via Higgsfield)
-- that serves as the post's hero on the detail page and as the card image
-- on the feed lead / river card. Plain TEXT, nullable.
--
-- Source of truth:
--   - Existing native rows: backfilled by `npm run apply-illustrations`
--     from backend/scripts/illustration-manifest.json (reviewed before
--     apply). Idempotent UPDATE guarded on source_type = 'native'.
--   - New native posts: forward generation is deferred to Phase 13 (see
--     the TODO in writeEvent.ts). The pipeline will populate this column
--     at write time once wired to the Higgsfield API.
--
-- Ingested events and legacy stories never carry an illustration; the
-- read side renders it only for native posts, and image_url (the scraped
-- og:image) always takes priority when both are present.

ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "illustration_url" text;
