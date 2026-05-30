-- 0039 — Phase 12n.3: two more native generator sources.
--
-- Follow-up to 0038, which seeded the two weekly-synthesis generators. This
-- adds the two 12n.3 generators:
--   - earnings-reaction-native        — per-filing EDGAR earnings reaction
--                                       (Finance, Semis)
--   - supply-chain-synthesis-native   — weekly semis supply-chain bottleneck
--                                       synthesis (Semis only)
--
-- Both reuse the existing 'SIGNAL' writer (0037 created it under a NOT EXISTS
-- guard; this migration only references it). Source rows mirror 0038's shape:
--   - adapter_type = 'native_generator' — registry slot is null, so the poll
--     worker no-ops it; the native generation CLI drives it instead.
--   - enabled = true — REQUIRED so the feed's event ranking (which excludes
--     events whose every source is disabled) keeps native events visible.
--   - fetch_interval_seconds = 0 — scheduleSourcePollRepeatable skips
--     interval <= 0, so neither is ever a repeatable poll job.
--   - priority = 2 — analyst tier (1=lab/SEC, 2=analyst, 3=news,
--     4=community); native editorial synthesis sits at analyst level.
--   - quality_score = 7 — mid-high; feeds the event effective_score.
--   - sectors — earnings reacts to Finance + Semis; supply-chain is Semis-only.
--
-- Each INSERT is guarded by NOT EXISTS on slug so re-applying is a no-op.

-- ---- EDGAR earnings/filing reaction source ----
INSERT INTO ingestion_sources
  (slug, display_name, adapter_type, endpoint, sectors,
   fetch_interval_seconds, quality_score, priority, enabled, paired_writer_id)
SELECT
  'earnings-reaction-native',
  'SIGNAL',
  'native_generator'::ingestion_adapter_type,
  NULL,
  ARRAY['finance','semiconductors'],
  0,
  7::smallint,
  2,
  true,
  w.id
FROM writers w
WHERE w.name = 'SIGNAL'
  AND NOT EXISTS (
    SELECT 1 FROM ingestion_sources s WHERE s.slug = 'earnings-reaction-native'
  );--> statement-breakpoint

-- ---- Semiconductor supply-chain synthesis source ----
INSERT INTO ingestion_sources
  (slug, display_name, adapter_type, endpoint, sectors,
   fetch_interval_seconds, quality_score, priority, enabled, paired_writer_id)
SELECT
  'supply-chain-synthesis-native',
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
    SELECT 1 FROM ingestion_sources s WHERE s.slug = 'supply-chain-synthesis-native'
  );
