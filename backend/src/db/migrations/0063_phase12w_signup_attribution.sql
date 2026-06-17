-- Phase 12w — first-touch signup attribution.
--
-- Captured client-side on first visit (utm_* from the URL, external referrer,
-- landing path) into localStorage, then sent with the signup request. Without
-- this, SIGNAL has no idea which channel produces signups — the spec's Layer 3
-- "source breakdown" premise. Must exist day one: attribution you never
-- collected can't be backfilled.
--
-- signup_source is the normalized channel (utm_source ?? referrer-host ??
-- 'direct'), derived server-side at signup, indexed for the growth report.
-- The raw fields are retained for drill-down.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS utm_source    text,
  ADD COLUMN IF NOT EXISTS utm_medium    text,
  ADD COLUMN IF NOT EXISTS utm_campaign  text,
  ADD COLUMN IF NOT EXISTS referrer      text,
  ADD COLUMN IF NOT EXISTS landing_path  text,
  ADD COLUMN IF NOT EXISTS signup_source text;

CREATE INDEX IF NOT EXISTS users_signup_source_idx ON users (signup_source);
