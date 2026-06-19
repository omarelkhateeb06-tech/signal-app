-- Tripwire redesign — positions + alerts (Phase A data model).
--
-- SIGNAL is being reshaped from a ranked news feed into a silent,
-- stakes-triggered alerter: the reader declares the positions/theses they've
-- staked, and the system stays quiet until a development materially moves one.
-- Internally the belief_* table names are kept (a user-facing rename to
-- positions/alerts is deferred — pure churn, invisible to users); this
-- migration only adds the fields the redesigned surface needs. All additive.
--
-- user_beliefs == a "position": conviction (1-5, how strongly held), horizon
--   (the bet's time frame, free text e.g. "Q4 2026"), what_would_break_it (the
--   explicit falsifier — also a strong signal for the matcher).
-- belief_challenges == an "alert": notified_at makes email delivery idempotent
--   (an alert is emailed at most once).

ALTER TABLE user_beliefs
  ADD COLUMN IF NOT EXISTS conviction INTEGER,
  ADD COLUMN IF NOT EXISTS horizon TEXT,
  ADD COLUMN IF NOT EXISTS what_would_break_it TEXT;

ALTER TABLE belief_challenges
  ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ;
