-- Phase 12u — content-type classification on events.
--
-- Distinguishes SEC / earnings filings from general ingested news so the feed
-- can render a distinct data-led card ("Earnings / SEC reaction"). NULL means
-- unclassified / general; 'filing' is set at write time by writeEvent.ts when
-- the source's adapter_type is 'sec_edgar_json'. Idempotent: re-running is a
-- clean no-op on an already-migrated database.

ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "content_type" text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'events_content_type_check'
  ) THEN
    ALTER TABLE "events"
      ADD CONSTRAINT "events_content_type_check"
      CHECK ("content_type" IS NULL OR "content_type" IN ('filing', 'general'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "events_content_type_idx" ON "events" ("content_type");

-- Backfill: any event whose primary or alternate source is a SEC EDGAR feed
-- (slug 'sec-edgar-%') is a filing. Touches only currently-unclassified rows
-- so a re-run never overwrites a deliberate value.
UPDATE "events" e
  SET "content_type" = 'filing'
  WHERE e."content_type" IS NULL
    AND EXISTS (
      SELECT 1
        FROM "event_sources" es
        JOIN "ingestion_sources" isrc ON isrc.id = es.ingestion_source_id
        WHERE es.event_id = e.id
          AND isrc.slug LIKE 'sec-edgar-%'
    );
