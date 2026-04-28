-- Phase 12e.4 — LLM relevance-gate schema additions.
--
-- 1. Extend ingestion_candidate_status with `llm_relevant`. The new
--    positive-marker state for candidates that cleared the LLM
--    relevance gate AND are awaiting fact extraction (12e.5a).
--    `llm_rejected` remains the LLM-stage rejection terminal.
--    Symmetric with the 12e.3 `heuristic_passed` add.
--
-- 2. Add nullable `sector` text column to ingestion_candidates. Stores
--    the LLM's classification when relevant=true; NULL otherwise.
--    Vocabulary is `ai | finance | semiconductors` (app-side validated;
--    no Postgres enum — mirrors events.sector / stories.sector).
--
-- 3. Add nullable `llm_judgment_raw` jsonb column. Populated on every
--    successful LLM call regardless of relevance verdict. Holds
--    { model, promptText, responseText, latencyMs, attempts } for
--    retroactive prompt-quality analysis (G6 audit surface).
--
-- ALTER TYPE ADD VALUE is safe inside a transaction on PG 12+ as long
-- as the new value isn't referenced in the same transaction (it isn't).

ALTER TYPE ingestion_candidate_status ADD VALUE IF NOT EXISTS 'llm_relevant';

ALTER TABLE ingestion_candidates
  ADD COLUMN sector text;

ALTER TABLE ingestion_candidates
  ADD COLUMN llm_judgment_raw jsonb;
