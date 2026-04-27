-- Phase 11a: self-service API keys for the Intelligence API.
--
-- Drops the Phase 0 placeholder api_keys table (never wired up, 0 rows in
-- prod) and recreates it with the real shape:
--   - user_id FK to users (not an abstract customer_id)
--   - label + key_prefix for display/debug
--   - HMAC-SHA256 hex digest (64 chars) in key_hash — NOT bcrypt; the input
--     is a 256-bit random secret so work-factor hashing buys nothing and
--     adds verify latency to every API request
--   - revoked_at + partial unique index on (user_id, label) where active
--     only, so rotation (revoke-then-recreate-with-same-label) works
--
-- The api_key_tier enum from migration 0000 is left in place — unused but
-- cheap, and a future phase may reintroduce tiered limits.

DROP TABLE IF EXISTS "api_keys";--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"label" varchar(100) NOT NULL,
	"key_prefix" varchar(16) NOT NULL,
	"key_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "api_keys_user_id_idx" ON "api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "api_keys_user_label_active_unique" ON "api_keys" USING btree ("user_id","label") WHERE "revoked_at" IS NULL;
