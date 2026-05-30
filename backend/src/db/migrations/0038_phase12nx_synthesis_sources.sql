-- 0038 — Phase 12n.x: two weekly-synthesis native generator sources.
--
-- Follow-up to 0037, which seeded the GitHub-trending native source and the
-- shared 'SIGNAL' editorial byline writer. This adds the two synthesis
-- generators 12n.x ships:
--   - arxiv-synthesis-native  — weekly arXiv research through-line (AI, Semis)
--   - hn-synthesis-native     — weekly HN community-attention read (all sectors)
--
-- Both reuse the existing 'SIGNAL' writer (0037 created it under a NOT EXISTS
-- guard; this migration only references it). Source rows mirror 0037's shape:
--   - adapter_type = 'native_generator' — registry slot is null, so the poll
--     worker no-ops it; the native generation CLI drives it instead.
--   - enabled = true — REQUIRED so the feed's event ranking (which excludes
--     events whose every source is disabled) keeps native events visible.
--   - fetch_interval_seconds = 0 — scheduleSourcePollRepeatable skips
--     interval <= 0, so neither is ever a repeatable poll job.
--   - priority = 2 — analyst tier (1=lab/SEC, 2=analyst, 3=news,
--     4=community); native editorial synthesis sits at analyst level.
--   - quality_score = 7 — mid-high; feeds the event effective_score.
--   - sectors — arXiv emits AI + Semis; HN can emit any of the three.
--
-- Each INSERT is guarded by NOT EXISTS on slug so re-applying is a no-op.

-- ---- arXiv weekly synthesis source ----
INSERT INTO ingestion_sources
  (slug, display_name, adapter_type, endpoint, sectors,
   fetch_interval_seconds, quality_score, priority, enabled, paired_writer_id)
SELECT
  'arxiv-synthesis-native',
  'SIGNAL',
  'native_generator'::ingestion_adapter_type,
  NULL,
  ARRAY['ai','semiconductors'],
  0,
  7::smallint,
  2,
  true,
  w.id
FROM writers w
WHERE w.name = 'SIGNAL'
  AND NOT EXISTS (
    SELECT 1 FROM ingestion_sources s WHERE s.slug = 'arxiv-synthesis-native'
  );--> statement-breakpoint

-- ---- HN community synthesis source ----
INSERT INTO ingestion_sources
  (slug, display_name, adapter_type, endpoint, sectors,
   fetch_interval_seconds, quality_score, priority, enabled, paired_writer_id)
SELECT
  'hn-synthesis-native',
  'SIGNAL',
  'native_generator'::ingestion_adapter_type,
  NULL,
  ARRAY['ai','finance','semiconductors'],
  0,
  7::smallint,
  2,
  true,
  w.id
FROM writers w
WHERE w.name = 'SIGNAL'
  AND NOT EXISTS (
    SELECT 1 FROM ingestion_sources s WHERE s.slug = 'hn-synthesis-native'
  );
