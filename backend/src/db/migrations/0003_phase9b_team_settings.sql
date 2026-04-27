-- Phase 9b-1: team settings + team-scoped indexes
-- Adds teams.settings (jsonb) and an index to speed up team-scoped comment queries.

ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "settings" jsonb NOT NULL DEFAULT '{"sectors": []}'::jsonb;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "comments_story_idx" ON "comments" ("story_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comments_team_story_idx" ON "comments" ("team_id","story_id");
