-- Phase 12i — daily digest. Replaces the Phase 7 weekly digest. Two
-- changes to `user_profiles.email_frequency`:
--
--   1. Backfill: every row currently set to 'weekly' migrates to
--      'daily'. The weekly digest is deprecated as of 12i; leaving
--      rows on 'weekly' would silently opt them out (the new daily
--      job filters `email_frequency = 'daily'`).
--   2. Default: switches from 'weekly' to 'daily' on the column so
--      new signups land in the digest pool by default. The Pro-tier
--      gate is enforced at query time in sendDailyDigests, so a free
--      signup with this default is filtered out — harmless.
--
-- 'never' and 'daily' rows are left untouched. The 'never' path
-- remains the user-side opt-out; the unsubscribe endpoint writes
-- 'never' to suppress all digests.

UPDATE "user_profiles"
SET "email_frequency" = 'daily'
WHERE "email_frequency" = 'weekly';--> statement-breakpoint

ALTER TABLE "user_profiles"
  ALTER COLUMN "email_frequency" SET DEFAULT 'daily';
