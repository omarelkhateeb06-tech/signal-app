-- Phase 12w — email engagement telemetry (SendGrid Event Webhook sink).
--
-- SendGrid POSTs delivered/open/click/bounce/dropped/spamreport/unsubscribe
-- events to /api/v1/emails/webhook; this is where they land. Without it the
-- daily digest (a core Pro deliverable) is a black box — open rate, CTOR, and
-- most-clicked-story (spec Layer 2) are all unmeasurable. Append-only.
--
-- sg_event_id is SendGrid's globally-unique per-event id; the partial unique
-- index dedupes webhook retries (SendGrid re-POSTs on a non-2xx). categories
-- carries the email's SendGrid categories (e.g. ["daily_digest"]) so reporting
-- can isolate digest engagement from transactional mail.
CREATE TABLE IF NOT EXISTS email_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sg_event_id   text,
  sg_message_id text,
  email         text NOT NULL,
  event_type    text NOT NULL,
  url           text,
  categories    jsonb NOT NULL DEFAULT '[]'::jsonb,
  occurred_at   timestamptz,
  raw           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Dedup webhook retries; partial so multiple rows with a NULL id are allowed.
CREATE UNIQUE INDEX IF NOT EXISTS email_events_sg_event_id_uidx
  ON email_events (sg_event_id)
  WHERE sg_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS email_events_email_idx ON email_events (email);
CREATE INDEX IF NOT EXISTS email_events_type_idx ON email_events (event_type);
CREATE INDEX IF NOT EXISTS email_events_occurred_idx ON email_events (occurred_at);
