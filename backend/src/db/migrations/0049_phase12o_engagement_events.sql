-- Phase 12o.2 / 12o.3 — engagement telemetry (scroll-dwell, click-through, share).
--
-- Append-only, mirrors onboarding_events: the client batches interaction events
-- and POSTs them to /api/v1/engagement/events; the endpoint only ever writes,
-- never reads on the request path. Powers Ranking v2 (12o.5) once real
-- behavioural data accrues — the plumbing ships pre-beta so collection starts
-- on day one rather than after the table is built.
--
-- event_id is an un-FK'd uuid on purpose: it may point at either the events or
-- the legacy stories namespace, and append-only telemetry must never fail an
-- insert because its target row was deleted.
CREATE TABLE IF NOT EXISTS engagement_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  event_id uuid,
  dwell_ms integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS engagement_events_user_created_idx ON engagement_events (user_id, created_at);
CREATE INDEX IF NOT EXISTS engagement_events_type_idx ON engagement_events (event_type);
CREATE INDEX IF NOT EXISTS engagement_events_event_idx ON engagement_events (event_id);
