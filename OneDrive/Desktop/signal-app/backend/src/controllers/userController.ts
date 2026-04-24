import type { NextFunction, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { userProfiles, userTopicInterests, users } from "../db/schema";
import { AppError } from "../middleware/errorHandler";
import {
  ROLES,
  SECTORS,
  SENIORITIES,
  isValidTopicForSector,
} from "../constants/onboardingTopics";
import { isValidDomain } from "../constants/domainOptions";

const GOAL_MAX_LENGTH = 64;
const NAME_MAX_LENGTH = 255;
const URL_MAX_LENGTH = 2048;
const TOPIC_MAX_LENGTH = 64;

// Phase 12b: depth_preference is optional in this endpoint because the
// settings UI is the only first-party caller that currently sends it;
// third-party integrations that predate 12b shouldn't be forced to set
// it on every save. The CHECK constraint on the column matches this
// three-value set.
const DEPTH_PREFERENCE_VALUES = ["accessible", "standard", "technical"] as const;

// Phase 12c — the Settings UI now edits the full commentary-input set
// (role/domain/seniority/sectors/goals/topics). All three new fields
// (`domain`, `seniority`, `topic_interests`) are OPTIONAL on the wire:
// older third-party callers and the "email-only" unsubscribe shim that
// predates 12c keep working unchanged. When a field is present in the
// body we diff it against the stored value and bump `profile_version`
// if anything commentary-relevant changed.
//
// Fields that BUMP profile_version: role, domain, seniority, sectors,
// goals, topics. Fields that do NOT: depth_preference (independent
// cache-key dimension already), email_frequency / email_unsubscribed
// (nothing to do with commentary).
//
// Roles/sectors/seniority use z.enum so the Zod error message identifies
// the exact invalid value; topic pairs are validated via a refine after
// basic shape because the sector↔topic relation is cross-field.
const topicSelectionSchema = z.object({
  sector: z.enum(SECTORS),
  topic: z.string().min(1).max(TOPIC_MAX_LENGTH),
});

const updateProfileSchema = z.object({
  sectors: z.array(z.enum(SECTORS)).min(1).max(SECTORS.length),
  role: z.enum(ROLES),
  goals: z.array(z.string().min(1).max(GOAL_MAX_LENGTH)).min(1).max(20),
  email_frequency: z.enum(["daily", "weekly", "never"]),
  email_unsubscribed: z.boolean().optional(),
  depth_preference: z.enum(DEPTH_PREFERENCE_VALUES).optional(),
  // Phase 12c additions — all optional for backward compat.
  domain: z
    .string()
    .min(1)
    .refine(isValidDomain, { message: "Domain is not a recognized value" })
    .optional(),
  seniority: z.enum(SENIORITIES).optional(),
  topic_interests: z.array(topicSelectionSchema).max(200).optional(),
});

const updateUserSchema = z
  .object({
    name: z.string().min(1).max(NAME_MAX_LENGTH).optional(),
    profile_picture_url: z.string().url().max(URL_MAX_LENGTH).nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Provide at least one field to update",
  });

function requireUserId(req: Request): string {
  if (!req.user) {
    throw new AppError("UNAUTHORIZED", "Not authenticated", 401);
  }
  return req.user.userId;
}

export async function getMyProfile(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);

    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        profilePictureUrl: users.profilePictureUrl,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) {
      throw new AppError("USER_NOT_FOUND", "User not found", 404);
    }

    const [profile] = await db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .limit(1);

    // Phase 12b: include topic interests alongside the profile, and
    // surface `onboarding_completed` as a top-level boolean so the
    // frontend doesn't have to re-derive `completed_at !== null` on
    // every render. The existing `profile` payload is unchanged to
    // keep the settings page happy.
    const topicRows = profile
      ? await db
          .select({
            sector: userTopicInterests.sector,
            topic: userTopicInterests.topic,
          })
          .from(userTopicInterests)
          .where(eq(userTopicInterests.userId, userId))
      : [];

    const onboardingCompleted = profile?.completedAt != null;

    res.json({
      data: {
        user,
        profile: profile ?? null,
        topic_interests: topicRows,
        onboarding_completed: onboardingCompleted,
      },
    });
  } catch (error) {
    next(error);
  }
}

// Set equality on string arrays — used to detect commentary-relevant
// changes to the set-shaped fields (sectors, goals, topics). Order
// and duplicates are ignored; what matters for commentary is "which
// values were chosen."
function sameSet(a: readonly string[] | null, b: readonly string[] | null): boolean {
  const aSet = new Set(a ?? []);
  const bSet = new Set(b ?? []);
  if (aSet.size !== bSet.size) return false;
  for (const v of aSet) {
    if (!bSet.has(v)) return false;
  }
  return true;
}

// Re-enforce the (sector, topic) pairing after Zod has validated each
// piece in isolation. Mirrors the onboarding controller's helper —
// duplicated rather than shared because the cross-field validation is
// cheap and keeping each controller self-contained avoids an import
// cycle between the two boundary surfaces.
function validateTopicPairs(
  topics: { sector: string; topic: string }[],
): { sector: string; topic: string }[] {
  const invalid = topics.filter((t) => !isValidTopicForSector(t.sector, t.topic));
  if (invalid.length > 0) {
    throw new AppError("INVALID_INPUT", "One or more topics are not valid for their sector", 400, {
      invalid,
    });
  }
  const seen = new Set<string>();
  return topics.filter((t) => {
    const key = `${t.sector}:${t.topic}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function updateMyProfile(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const input = updateProfileSchema.parse(req.body);

    // Validate + dedupe topics OUTSIDE the transaction so a 400 on an
    // invalid pair doesn't spin up a tx we'd just roll back.
    const validatedTopics =
      input.topic_interests !== undefined
        ? validateTopicPairs(input.topic_interests)
        : null;

    // Phase 12c — the full write runs inside a transaction so the
    // profile patch, profile_version bump, and (optional) topic-set
    // replacement land atomically. A partial write would leave the
    // commentary cache keyed on a stale profile_version.
    const profile = await db.transaction(async (tx) => {
      // Pull the fields we need to diff against — role, domain,
      // seniority, sectors, goals, profileVersion. We also select
      // userId so the existence check works for the insert path.
      const [existing] = await tx
        .select({
          userId: userProfiles.userId,
          role: userProfiles.role,
          domain: userProfiles.domain,
          seniority: userProfiles.seniority,
          sectors: userProfiles.sectors,
          goals: userProfiles.goals,
          profileVersion: userProfiles.profileVersion,
        })
        .from(userProfiles)
        .where(eq(userProfiles.userId, userId))
        .limit(1);

      // Read current topic interests only when the caller is supplying
      // a new topic set — otherwise the diff is skipped anyway.
      const existingTopics =
        existing && validatedTopics !== null
          ? await tx
              .select({
                sector: userTopicInterests.sector,
                topic: userTopicInterests.topic,
              })
              .from(userTopicInterests)
              .where(eq(userTopicInterests.userId, userId))
          : [];

      // Compute whether anything commentary-relevant changed. A fresh
      // insert (no `existing` row) is treated as "no bump needed" —
      // the column defaults to 1 and an upsert-from-settings for a
      // user with no profile row is an unusual-but-not-bump case
      // (profile_version=1 is the right starting point).
      let commentaryRelevantChanged = false;
      if (existing) {
        if (input.role !== existing.role) commentaryRelevantChanged = true;
        if (
          input.domain !== undefined &&
          input.domain !== (existing.domain ?? undefined)
        ) {
          commentaryRelevantChanged = true;
        }
        if (
          input.seniority !== undefined &&
          input.seniority !== (existing.seniority ?? undefined)
        ) {
          commentaryRelevantChanged = true;
        }
        if (!sameSet(existing.sectors, input.sectors)) {
          commentaryRelevantChanged = true;
        }
        if (!sameSet(existing.goals, input.goals)) {
          commentaryRelevantChanged = true;
        }
        if (validatedTopics !== null) {
          const existingKeys = existingTopics.map((t) => `${t.sector}:${t.topic}`);
          const newKeys = validatedTopics.map((t) => `${t.sector}:${t.topic}`);
          if (!sameSet(existingKeys, newKeys)) {
            commentaryRelevantChanged = true;
          }
        }
      }

      const patch: Record<string, unknown> = {
        sectors: input.sectors,
        role: input.role,
        goals: input.goals,
        emailFrequency: input.email_frequency,
        updatedAt: new Date(),
      };
      if (input.email_unsubscribed !== undefined) {
        patch.emailUnsubscribed = input.email_unsubscribed;
      }
      if (input.depth_preference !== undefined) {
        patch.depthPreference = input.depth_preference;
      }
      if (input.domain !== undefined) {
        patch.domain = input.domain;
      }
      if (input.seniority !== undefined) {
        patch.seniority = input.seniority;
      }
      if (existing && commentaryRelevantChanged) {
        patch.profileVersion = existing.profileVersion + 1;
      }

      let row;
      if (existing) {
        const [updated] = await tx
          .update(userProfiles)
          .set(patch)
          .where(eq(userProfiles.userId, userId))
          .returning();
        row = updated;
      } else {
        const [inserted] = await tx
          .insert(userProfiles)
          .values({ userId, ...patch })
          .returning();
        row = inserted;
      }

      // Replace the topic-interest set wholesale when supplied. Same
      // "delete-then-insert inside the same tx" pattern as the
      // onboarding completion path — safer than diffing and cheap at
      // the row counts we allow (max 200).
      if (validatedTopics !== null) {
        await tx
          .delete(userTopicInterests)
          .where(eq(userTopicInterests.userId, userId));
        if (validatedTopics.length > 0) {
          await tx.insert(userTopicInterests).values(
            validatedTopics.map((t) => ({
              userId,
              sector: t.sector,
              topic: t.topic,
            })),
          );
        }
      }

      return row;
    });

    if (!profile) {
      throw new AppError("PROFILE_UPDATE_FAILED", "Failed to update profile", 500);
    }

    res.json({ data: { profile } });
  } catch (error) {
    next(error);
  }
}

export async function updateMe(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const input = updateUserSchema.parse(req.body);

    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.profile_picture_url !== undefined) {
      patch.profilePictureUrl = input.profile_picture_url;
    }

    const [user] = await db
      .update(users)
      .set(patch)
      .where(eq(users.id, userId))
      .returning({
        id: users.id,
        email: users.email,
        name: users.name,
        profilePictureUrl: users.profilePictureUrl,
      });

    if (!user) {
      throw new AppError("USER_NOT_FOUND", "User not found", 404);
    }

    res.json({ data: { user } });
  } catch (error) {
    next(error);
  }
}
