-- Phase 12e.5d — two corrections to the ingestion_sources seed:
--
-- 1. sec-edgar-full: the endpoint returns Atom XML (output=atom), not JSON.
--    Changing adapter_type to 'rss' lets the existing rssAdapter handle it
--    with no new code.
--
-- 2. sec-edgar-semis: the endpoint has a {cik} placeholder — the adapter
--    loops over a CIK list stored in config. Populate config with the
--    initial chip-company CIK list.

UPDATE ingestion_sources
  SET adapter_type = 'rss'
  WHERE slug = 'sec-edgar-full';

UPDATE ingestion_sources
  SET config = jsonb_set(
    config,
    '{ciks}',
    '["0001045810","0000002488","0001046179","0000937556","0000050863","0000804328","0001730168","0001058057","0000723125","0000796343","0000707549","0000319201"]'::jsonb
  )
  WHERE slug = 'sec-edgar-semis';
