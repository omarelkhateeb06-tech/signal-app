-- Phase 9a: teams foundation
-- Reshapes teams + team_members and introduces team_invites.

ALTER TYPE "team_member_role" ADD VALUE IF NOT EXISTS 'viewer';--> statement-breakpoint

ALTER TABLE "teams" DROP COLUMN IF EXISTS "admin_user_id";--> statement-breakpoint
ALTER TABLE "teams" DROP COLUMN IF EXISTS "company_name";--> statement-breakpoint
ALTER TABLE "teams" DROP COLUMN IF EXISTS "tier";--> statement-breakpoint

ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "description" varchar(500);--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "slug" varchar(100);--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "created_by" uuid;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint

UPDATE "teams" SET "slug" = "id"::text WHERE "slug" IS NULL;--> statement-breakpoint
ALTER TABLE "teams" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "teams" ADD CONSTRAINT "teams_slug_unique" UNIQUE ("slug");
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "teams" ADD CONSTRAINT "teams_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "teams_slug_idx" ON "teams" ("slug");--> statement-breakpoint

DROP TYPE IF EXISTS "team_tier";--> statement-breakpoint

ALTER TABLE "team_members" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "team_members_team_idx" ON "team_members" ("team_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "team_members_user_idx" ON "team_members" ("user_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "team_invites" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "team_id" uuid NOT NULL,
    "email" varchar(255) NOT NULL,
    "role" "team_member_role" DEFAULT 'member' NOT NULL,
    "token" text NOT NULL,
    "invited_by" uuid,
    "expires_at" timestamp with time zone NOT NULL,
    "used_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "team_invites_token_unique" UNIQUE ("token")
);--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "team_invites" ADD CONSTRAINT "team_invites_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "team_invites" ADD CONSTRAINT "team_invites_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "team_invites_team_email_idx" ON "team_invites" ("team_id","email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "team_invites_token_idx" ON "team_invites" ("token");
