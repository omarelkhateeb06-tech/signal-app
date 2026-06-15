-- 0060_phase12_event_topics.sql
-- Adds events.topics for the "In Focus" topic chips (LLM entity extraction).
-- Populated out-of-band by the topic-extraction job (extractTopicsForEvent),
-- not on the ingestion write path. The GIN index supports the in-focus
-- aggregation (unnest + group-by-frequency) and any future topic filter.
--
-- topics_extracted_at marks that the job has processed a row (on success OR a
-- genuinely-empty result), so an event the model finds no topics for is not
-- re-queued every run. NULL = not yet attempted.

ALTER TABLE events ADD COLUMN IF NOT EXISTS topics text[] NOT NULL DEFAULT '{}';
ALTER TABLE events ADD COLUMN IF NOT EXISTS topics_extracted_at timestamptz;

CREATE INDEX IF NOT EXISTS events_topics_gin_idx ON events USING GIN (topics);
