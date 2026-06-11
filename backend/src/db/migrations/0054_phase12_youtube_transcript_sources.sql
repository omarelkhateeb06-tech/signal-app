-- 0054 — Phase 12 ingestion Tier 2: YouTube episode-dispatch native sources.
--
-- Five hand-curated long-form channels, one source row per channel so each
-- generator instance gets its own (source_id, external_id) dedup space and
-- can be disabled independently:
--   - youtube-dwarkesh-native       Dwarkesh Patel   (ai)
--   - youtube-asianometry-native    Asianometry      (semiconductors)
--   - youtube-techtechpotato-native TechTechPotato   (semiconductors)
--   - youtube-nopriors-native       No Priors        (ai)
--   - youtube-acquired-native       Acquired         (finance)
--
-- Rows mirror 0042's native-generator shape (and reuse the 0037 'SIGNAL'
-- editorial writer):
--   - adapter_type = 'native_generator' — no poll-adapter slot; the native
--     generation scheduler drives these, not the poll worker.
--   - enabled = true — REQUIRED so event ranking (which excludes events whose
--     every source is disabled) keeps the dispatches visible.
--   - fetch_interval_seconds = 0 — scheduleSourcePollRepeatable skips
--     interval <= 0, so none is ever a repeatable poll job.
--   - priority = 2, quality_score = 7 — analyst tier, same as the other
--     native editorial generators.
--   - endpoint NULL — channel handles live with the generator roster
--     (generators/youtubeTranscript.ts YOUTUBE_CHANNELS), which is the
--     single source of truth the code reads.
--
-- The generators additionally require YOUTUBE_API_KEY (and ANTHROPIC_API_KEY
-- for authoring); both unset degrade to a logged skip, so seeding ahead of
-- the keys landing in Railway is safe. Each INSERT is guarded by NOT EXISTS
-- on slug so re-applying is a no-op.

INSERT INTO ingestion_sources
  (slug, display_name, adapter_type, endpoint, sectors,
   fetch_interval_seconds, quality_score, priority, enabled, paired_writer_id)
SELECT
  'youtube-dwarkesh-native',
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
    SELECT 1 FROM ingestion_sources s WHERE s.slug = 'youtube-dwarkesh-native'
  );--> statement-breakpoint

INSERT INTO ingestion_sources
  (slug, display_name, adapter_type, endpoint, sectors,
   fetch_interval_seconds, quality_score, priority, enabled, paired_writer_id)
SELECT
  'youtube-asianometry-native',
  'SIGNAL',
  'native_generator'::ingestion_adapter_type,
  NULL,
  ARRAY['semiconductors'],
  0,
  7::smallint,
  2,
  true,
  w.id
FROM writers w
WHERE w.name = 'SIGNAL'
  AND NOT EXISTS (
    SELECT 1 FROM ingestion_sources s WHERE s.slug = 'youtube-asianometry-native'
  );--> statement-breakpoint

INSERT INTO ingestion_sources
  (slug, display_name, adapter_type, endpoint, sectors,
   fetch_interval_seconds, quality_score, priority, enabled, paired_writer_id)
SELECT
  'youtube-techtechpotato-native',
  'SIGNAL',
  'native_generator'::ingestion_adapter_type,
  NULL,
  ARRAY['semiconductors'],
  0,
  7::smallint,
  2,
  true,
  w.id
FROM writers w
WHERE w.name = 'SIGNAL'
  AND NOT EXISTS (
    SELECT 1 FROM ingestion_sources s WHERE s.slug = 'youtube-techtechpotato-native'
  );--> statement-breakpoint

INSERT INTO ingestion_sources
  (slug, display_name, adapter_type, endpoint, sectors,
   fetch_interval_seconds, quality_score, priority, enabled, paired_writer_id)
SELECT
  'youtube-nopriors-native',
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
    SELECT 1 FROM ingestion_sources s WHERE s.slug = 'youtube-nopriors-native'
  );--> statement-breakpoint

INSERT INTO ingestion_sources
  (slug, display_name, adapter_type, endpoint, sectors,
   fetch_interval_seconds, quality_score, priority, enabled, paired_writer_id)
SELECT
  'youtube-acquired-native',
  'SIGNAL',
  'native_generator'::ingestion_adapter_type,
  NULL,
  ARRAY['finance'],
  0,
  7::smallint,
  2,
  true,
  w.id
FROM writers w
WHERE w.name = 'SIGNAL'
  AND NOT EXISTS (
    SELECT 1 FROM ingestion_sources s WHERE s.slug = 'youtube-acquired-native'
  );
