-- Belief challenge relevance — the hybrid "loud + radar" matcher.
--
-- The first matcher was contradiction-only: it wrote a belief_challenges row
-- only when a development genuinely refuted a belief. For long-horizon beliefs
-- that is silent most weeks, which reads as a dead feature. The hybrid matcher
-- instead always surfaces the single most-relevant development per belief and
-- classifies how it bears on the belief. `relevance` carries that
-- classification; the existing `how_to_update` column now holds the directional
-- "read" for every relevance (not only refutations), and `dissent` holds the
-- honest counter-view.
--
--   contradicts — genuine evidence the belief is wrong/weakening (the loud one)
--   pressures   — real tension that raises the bar, but not refutation
--   supports    — evidence the belief is holding/strengthening
--   watch       — adjacent, worth tracking, not yet moving the belief
--
-- Pre-hybrid rows were all refutations, so they backfill to 'contradicts'.

ALTER TABLE belief_challenges
  ADD COLUMN IF NOT EXISTS relevance TEXT;

UPDATE belief_challenges SET relevance = 'contradicts' WHERE relevance IS NULL;

ALTER TABLE belief_challenges ALTER COLUMN relevance SET DEFAULT 'contradicts';
ALTER TABLE belief_challenges ALTER COLUMN relevance SET NOT NULL;

-- CHECK lacks IF NOT EXISTS; guard it so the migration is re-runnable.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'belief_challenges_relevance_check'
  ) THEN
    ALTER TABLE belief_challenges
      ADD CONSTRAINT belief_challenges_relevance_check
      CHECK (relevance IN ('contradicts', 'pressures', 'supports', 'watch'));
  END IF;
END $$;
