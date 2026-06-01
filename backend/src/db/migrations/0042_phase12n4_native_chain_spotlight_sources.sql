-- 0042 — Phase 12n.4: two new native generator sources (chain + spotlight).
--
-- Follow-up to 0037/0038, which seeded the GitHub-trending and weekly-
-- synthesis native sources and the shared 'SIGNAL' editorial byline writer.
-- This adds the two DAILY generators 12n.4 ships:
--   - cross-sector-chain-native — daily cross-sector causal chain (all sectors)
--   - tool-spotlight-native      — daily "why now" tool spotlight (AI/dev pool)
--
-- Both reuse the existing 'SIGNAL' writer (0037 created it under a NOT EXISTS
-- guard; this migration only references it). Source rows mirror 0038's shape:
--   - adapter_type = 'native_generator' — no poll-adapter slot, so the poll
--     worker no-ops it; the native generation CLI drives it instead.
--   - enabled = true — REQUIRED so the feed's event ranking (which excludes
--     events whose every source is disabled) keeps native events visible.
--   - fetch_interval_seconds = 0 — scheduleSourcePollRepeatable skips
--     interval <= 0, so neither is ever a repeatable poll job.
--   - priority = 2 — analyst tier (1=lab/SEC, 2=analyst, 3=news,
--     4=community); native editorial synthesis sits at analyst level.
--   - quality_score = 7 — mid-high; feeds the event effective_score.
--   - sectors — the chain spans all three; the spotlight reads the HN github
--     pool, which is ~entirely AI/dev tooling, so it tags 'ai'.
--
-- Each INSERT is guarded by NOT EXISTS on slug so re-applying is a no-op.

-- ---- Cross-sector causal-chain source ----
INSERT INTO ingestion_sources
  (slug, display_name, adapter_type, endpoint, sectors,
   fetch_interval_seconds, quality_score, priority, enabled, paired_writer_id)
SELECT
  'cross-sector-chain-native',
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
    SELECT 1 FROM ingestion_sources s WHERE s.slug = 'cross-sector-chain-native'
  );--> statement-breakpoint

-- ---- Tool-spotlight source ----
INSERT INTO ingestion_sources
  (slug, display_name, adapter_type, endpoint, sectors,
   fetch_interval_seconds, quality_score, priority, enabled, paired_writer_id)
SELECT
  'tool-spotlight-native',
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
    SELECT 1 FROM ingestion_sources s WHERE s.slug = 'tool-spotlight-native'
  );
