-- Belief maintenance (the missionary pivot).
--
-- SIGNAL stops being a stay-informed feed and becomes a belief-maintenance
-- surface: the reader records their working assumptions, and SIGNAL flags
-- when a development materially challenges one. The unit of value is a
-- belief revised, not a story read; the north star is assumptions-updated
-- per user per month (logged via product_events 'belief_revised').
--
-- user_beliefs      — the reader's working assumptions, in their own words.
-- belief_challenges — a flagged contradiction for a belief in a given ISO
--                     week, carrying the Haiku "how your view should update"
--                     + the informed dissent. The table doubles as the
--                     per-(belief, week) cache: the matcher writes once and
--                     re-reads. `response` records the reader's verdict
--                     (revised/held/dismissed) for the north star.

CREATE TABLE IF NOT EXISTS user_beliefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  statement TEXT NOT NULL,
  sector TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revised', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Hot path: list a reader's active beliefs.
CREATE INDEX IF NOT EXISTS user_beliefs_active_idx
  ON user_beliefs (user_id)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS belief_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  belief_id UUID NOT NULL REFERENCES user_beliefs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id UUID REFERENCES events(id) ON DELETE SET NULL,
  week_key TEXT NOT NULL,
  how_to_update TEXT NOT NULL,
  dissent TEXT,
  source_headline TEXT,
  response TEXT CHECK (response IN ('revised', 'held', 'dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ
);

-- Dedup the matcher: at most one challenge per (belief, week, triggering
-- event). NULL event_ids are distinct in Postgres, so the controller also
-- guards on "any challenge already exists for this (user, week)" before
-- re-running the matcher.
CREATE UNIQUE INDEX IF NOT EXISTS belief_challenges_dedup_idx
  ON belief_challenges (belief_id, week_key, event_id);

-- Hot path: load this week's challenges for a reader.
CREATE INDEX IF NOT EXISTS belief_challenges_user_week_idx
  ON belief_challenges (user_id, week_key);
