-- Comp the product owner's account to Pro so the full Pro experience
-- (unlimited stories, depth tiers, personalized commentary, and "The
-- Through-Line") is exercisable on production without going through the
-- (not-yet-built) Stripe checkout.
--
-- Data-only; no schema change. Idempotent — re-running is a no-op, and it
-- touches nothing in any environment where this account does not exist
-- (dev / staging / fresh DBs simply match zero rows). Setting `tier='pro'`
-- directly means `resolveEffectiveTier` treats the account as paid and
-- never lazy-downgrades it (no trial window involved).
UPDATE "users"
SET "tier" = 'pro',
    "tier_changed_at" = now()
WHERE "email" = 'oelkhateeb6@gmail.com'
  AND "tier" <> 'pro';
