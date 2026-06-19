-- Phase 12x — belief matcher cost guard.
--
-- runChallenges dedups against existing belief_challenges rows, but a belief
-- the matcher found NO contradiction for produces no row — so clean beliefs
-- were re-sent to Haiku on every "Run check". This column records that a
-- belief was checked for a given ISO week regardless of outcome, so re-runs
-- within the same week skip it. Nullable: existing beliefs read as "never
-- checked" and get processed once on the next run.
ALTER TABLE user_beliefs
  ADD COLUMN IF NOT EXISTS last_checked_week_key TEXT;
