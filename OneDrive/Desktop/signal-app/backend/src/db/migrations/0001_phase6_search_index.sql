CREATE INDEX IF NOT EXISTS "stories_fts_idx" ON "stories" USING GIN (
  to_tsvector('english', coalesce("headline", '') || ' ' || coalesce("context", ''))
);
