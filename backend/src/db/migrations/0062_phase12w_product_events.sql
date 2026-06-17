-- Phase 12w — product / funnel analytics event sink.
--
-- Backs POST /api/v1/events, the destination for lib/analytics.ts's track()
-- beacon (upgrade_viewed, checkout_started, signup funnel, theme_toggled).
-- Until now those beacons POSTed to an unmounted route and were silently
-- dropped — the free->paid funnel had no data.
--
-- Distinct from engagement_events: product/funnel events fire pre-auth
-- (landing, signup funnel) and feed-level, so user_id is NULLABLE here.
-- engagement_events requires an authed user; this does not. ON DELETE SET
-- NULL keeps the event row (and its funnel value) after a user is deleted.
-- Append-only; never read on the request path.
CREATE TABLE IF NOT EXISTS product_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  path text,
  props jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_events_type_created_idx ON product_events (event_type, created_at);
CREATE INDEX IF NOT EXISTS product_events_user_idx ON product_events (user_id);
CREATE INDEX IF NOT EXISTS product_events_created_idx ON product_events (created_at);
