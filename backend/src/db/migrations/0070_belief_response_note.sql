-- Partial B (Belief Evolution) — let the reader annotate how a development moved
-- a belief. The reskin shifts the surface from "alerts when you're wrong" to a
-- log of how your thinking evolves; response_note captures the reader's own
-- words on each evolution step ("this shifted me", "this only hardened it") —
-- the journal layer the evolution timeline reads back. Additive.

ALTER TABLE belief_challenges
  ADD COLUMN IF NOT EXISTS response_note TEXT;
