-- Phase 12e.x — add form-type allowlist to sec-edgar-full source.
--
-- The full EDGAR getcurrent feed emits every filing form code (424B2,
-- ABS-15G, POS EX, 13F-HR, ...). The 12h soak showed 156 of 915
-- candidates from this source publishing in 12 hours, almost all on
-- low-signal forms. The rss adapter now reads `config.formTypeAllowlist`
-- and drops items whose parsed form-type isn't in the set, before they
-- become candidate rows.

UPDATE ingestion_sources
  SET config = jsonb_set(
    COALESCE(config, '{}'::jsonb),
    '{formTypeAllowlist}',
    '["8-K","10-K","10-Q","S-1","20-F","6-K","DEF 14A","SC 13G","SC 13D","Form 4","424B3","424B4"]'::jsonb
  )
  WHERE slug = 'sec-edgar-full';
