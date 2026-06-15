-- Phase 12h — Stripe billing.
-- Adds stripe_customer_id and stripe_subscription_id to users.
-- Both are nullable: populated on first successful checkout.session.completed
-- webhook; stripe_subscription_id is cleared on customer.subscription.deleted
-- (customer_id is kept for re-subscribes so Stripe doesn't create duplicates).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS stripe_customer_id    text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text;

-- One customer per user; nulls are excluded (un-paid users have no customer yet).
CREATE UNIQUE INDEX IF NOT EXISTS users_stripe_customer_id_uidx
  ON users (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_stripe_subscription_id_uidx
  ON users (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;
