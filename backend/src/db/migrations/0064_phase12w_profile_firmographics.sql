-- Phase 12w — optional firmographics + self-reported acquisition source.
--
-- company / company_size (Screen 2) and how_did_you_hear (Screen 7) are the
-- spec's Layer 1 firmographic fields + Layer 1 "how did you find SIGNAL?".
-- All OPTIONAL: captured opt-in, never gate onboarding completion. company is
-- free text; company_size and how_did_you_hear are CHECK-constrained (NULL or
-- a known value) so the data stays clean for the data-asset reports.
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS company          text,
  ADD COLUMN IF NOT EXISTS company_size     text,
  ADD COLUMN IF NOT EXISTS how_did_you_hear text;

-- CHECKs allow NULL (the field is optional) or a value from the known set.
-- DROP-then-ADD keeps the migration idempotent across re-runs.
ALTER TABLE user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_company_size_check;
ALTER TABLE user_profiles
  ADD CONSTRAINT user_profiles_company_size_check
  CHECK (company_size IS NULL OR company_size IN
    ('1-10', '11-50', '51-200', '201-1000', '1000+'));

ALTER TABLE user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_how_did_you_hear_check;
ALTER TABLE user_profiles
  ADD CONSTRAINT user_profiles_how_did_you_hear_check
  CHECK (how_did_you_hear IS NULL OR how_did_you_hear IN
    ('reddit', 'twitter', 'linkedin', 'hacker_news', 'search', 'referral', 'other'));
