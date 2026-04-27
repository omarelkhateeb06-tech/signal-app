-- Phase 11c.5: precomputed sector-level weekly rollups for
-- /api/v2/trends/:sector. Populated by the aggregation job
-- (`aggregationJob.ts`) on a daily cron; momentum is derived on read,
-- not stored — so only raw counts live here.
--
-- `save_count` is reserved for future engagement-weighted aggregation
-- and stays 0 in v1. Shipping the column now means the user_saves JOIN
-- can be added later without a migration or API contract change.
--
-- UNIQUE(sector, period) is the upsert target on job re-runs. Postgres
-- auto-creates a btree index for the constraint, so it also serves the
-- primary read query (sector + recent periods) without a separate index.

CREATE TABLE IF NOT EXISTS "story_aggregates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sector" varchar(50) NOT NULL,
	"period" varchar(10) NOT NULL,
	"story_count" integer DEFAULT 0 NOT NULL,
	"save_count" integer DEFAULT 0 NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "story_aggregates_sector_period_unique" UNIQUE("sector","period")
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "story_aggregates_computed_at_idx" ON "story_aggregates" USING btree ("computed_at");
