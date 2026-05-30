-- 0037 — Phase 12n.2: native posts, part 2 (GitHub-trending native source).
--
-- Follow-up to 0036. Seeds the one native generator source this slice
-- ships: the GitHub trending generator. Split from 0036 because this
-- INSERT *uses* the 'native_generator' enum value that 0036 added, and
-- Postgres can't use a new enum label in the transaction that adds it
-- (the runner applies each migration file as one BEGIN/COMMIT).
--
-- The source row is deliberately shaped so the native generator stays
-- OUT of the RSS poll loop while remaining feed-visible:
--   - adapter_type = 'native_generator' — the adapter registry slot is
--     null, so the poll worker would no-op it anyway; the native
--     generation CLI drives it instead.
--   - enabled = true — REQUIRED. The feed's event ranking excludes any
--     event whose every event_source is disabled, so native events would
--     be hidden if this source were disabled.
--   - fetch_interval_seconds = 0 — scheduleSourcePollRepeatable skips
--     sources with interval <= 0, so this is never registered as a
--     repeatable poll job. The clean "enabled but not polled" escape
--     hatch.
--   - priority = 2 — analyst tier per the 0022 rubric (1=lab/SEC,
--     2=analyst, 3=news, 4=community). Native editorial synthesis sits at
--     analyst level.
--   - quality_score = 7 — mid-high; feeds the event effective_score via
--     the primary source quality term.
--   - sectors = {ai} — this generator only emits AI-sector posts. The
--     byline writer carries all three sectors since the native editorial
--     voice will span sectors as later generators (12n.4) land.
--
-- Pattern mirrors 0034/0035: paired `writers` row first under a NOT
-- EXISTS guard, then the source row JOINs writers on name.

-- ---- Paired writer (the native editorial byline) ----
INSERT INTO writers (name, sectors)
SELECT 'SIGNAL', '["ai","finance","semiconductors"]'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM writers existing WHERE existing.name = 'SIGNAL'
);--> statement-breakpoint

-- ---- Native GitHub-trending source row ----
INSERT INTO ingestion_sources
  (slug, display_name, adapter_type, endpoint, sectors,
   fetch_interval_seconds, quality_score, priority, enabled, paired_writer_id)
SELECT
  'github-trending-native',
  'SIGNAL',
  'native_generator'::ingestion_adapter_type,
  NULL,
  ARRAY['ai'],
  0,
  7::smallint,
  2,
  true,
  w.id
FROM writers w
WHERE w.name = 'SIGNAL'
  AND NOT EXISTS (
    SELECT 1 FROM ingestion_sources s WHERE s.slug = 'github-trending-native'
  );
