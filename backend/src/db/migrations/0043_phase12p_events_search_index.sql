-- Phase 12p — full-text search index on the events table.
--
-- searchStories previously queried only the legacy `stories` table (20
-- hand-curated seed rows). This migration adds a GIN index so the
-- rewritten query can hit `events` with the same websearch_to_tsquery
-- / ts_rank pattern at comparable latency.
--
-- Text columns indexed:
--   headline        — the lead signal; always present
--   why_it_matters  — editorial summary ("why this matters"); high signal
--   generic_commentary — hook + body shown in feed cards; directly readable
--
-- `context` (scraped article body HTML) is intentionally excluded: it is
-- noisy, can be very long, and the editorial summaries above cover the same
-- ground with less noise. The index can be expanded in a later migration if
-- recall data shows `context` terms are worth the cost.
CREATE INDEX IF NOT EXISTS "events_fts_idx" ON "events" USING GIN (
  to_tsvector('english',
    coalesce("headline", '') || ' ' ||
    coalesce("why_it_matters", '') || ' ' ||
    coalesce("generic_commentary", '')
  )
);
