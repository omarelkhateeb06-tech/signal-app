-- Phase 12e.7b — commentary_cache.story_id FK dropped so the column can
-- carry either a story id or an event id (single UUID namespace).
-- The column stays NOT NULL and uuid — only the FK constraint is removed.
-- Cascade-delete from stories no longer fires; orphaned cache rows for
-- deleted events are handled by the 12c.1 GC stub.
ALTER TABLE commentary_cache
  DROP CONSTRAINT commentary_cache_story_id_fk;
