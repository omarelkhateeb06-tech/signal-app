-- Phase 9: distinguish admin-revoked invites from accepted ones.
-- Adds team_invites.revoked_at (nullable). No backfill: for historical rows,
-- NULL is the correct value — either not revoked, or we can't retroactively
-- tell "used by admin revoke" vs "used by invite acceptance" from used_at alone.

ALTER TABLE "team_invites" ADD COLUMN IF NOT EXISTS "revoked_at" timestamp with time zone;
