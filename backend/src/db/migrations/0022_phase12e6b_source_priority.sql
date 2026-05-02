-- 0022 — Phase 12e.6b: source priority for primary-source promotion on cluster match.
--
-- Lower value = higher priority. Used by the 12e.6b dispatch when an
-- incoming candidate clusters onto an existing event: if its source's
-- priority outranks the current primary's source, the incoming source
-- promotes to role='primary' and the existing primary demotes to
-- role='alternate'. Otherwise the incoming attaches as 'alternate' and
-- the existing primary stands.
--
-- Tier rubric:
--   1: lab blogs, primary research (arXiv, HF Papers), regulators
--      (SEC EDGAR, Federal Reserve, BLS, BIS), first-party newsroom
--   2: analyst newsletters and curated digests
--   3: news outlets and trade press                 (DEFAULT)
--   4: community / aggregators (Hacker News, Reddit)

ALTER TABLE ingestion_sources
  ADD COLUMN priority integer NOT NULL DEFAULT 3;--> statement-breakpoint

-- Tier 1: first-party labs, primary research, regulators, first-party newsroom.
UPDATE ingestion_sources SET priority = 1 WHERE slug IN (
  'anthropic-news',
  'openai-news',
  'deepmind-blog',
  'google-research',
  'meta-ai-blog',
  'arxiv-ai-cl-lg',
  'huggingface-papers',
  'nvidia-newsroom',
  'amd-newsroom',
  'tsmc-newsroom',
  'asml-news',
  'intel-newsroom',
  'bis-press',
  'sec-edgar-semis',
  'sec-edgar-full',
  'fed-press',
  'bls-press'
);--> statement-breakpoint

-- Tier 2: analyst newsletters and curated digests.
UPDATE ingestion_sources SET priority = 2 WHERE slug IN (
  'import-ai',
  'interconnects',
  'simonwillison',
  'the-batch',
  'semianalysis',
  'fabricated-knowledge',
  'asianometry',
  'money-stuff',
  'the-diff',
  'net-interest',
  'apricitas',
  'marginal-revolution',
  'stratechery-free'
);--> statement-breakpoint

-- Tier 4: community / aggregators. (fred-api stays at the DEFAULT 3 — it
-- is currently disabled and would be repriced if/when re-enabled, since
-- it's a first-party data feed if enabled in production.)
UPDATE ingestion_sources SET priority = 4 WHERE slug IN (
  'hackernews',
  'reddit-finance'
);
