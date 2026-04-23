import type { NextFunction, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { userProfiles, userTopicInterests, users } from "../db/schema";
import { AppError } from "../middleware/errorHandler";

const SECTOR_MAX_LENGTH = 64;
const GOAL_MAX_LENGTH = 64;
const ROLE_MAX_LENGTH = 50;
const NAME_MAX_LENGTH = 255;
const URL_MAX_LENGTH = 2048;

// Phase 12b: depth_preference is optional in this endpoint because the
// settings UI is the only first-party caller that currently sends it;
// third-party integrations that predate 12b shouldn't be forced to set
// it on every save. The CHECK constraint on the column matches this
// three-value set.
const DEPTH_PREFERENCE_VALUES = ["accessible", "standard", "technical"] as const;

const updateProfileSchema = z.object({
  sectors: z.array(z.string().min(1).max(SECTOR_MAX_LENGTH)).min(1).max(20),
  role: z.string().min(1).max(ROLE_MAX_LENGTH),
  goals: z.array(z.string().min(1).max(GOAL_MAX_LENGTH)).min(1).max(20),
  email_frequency: z.enum(["daily", "weekly", "never"]),
  email_unsubscribed: z.boolean().optional(),
  depth_preference: z.enum(DEPTH_PREFERENCE_VALUES).optional(),
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

export async function updateMyProfile(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const input = updateProfileSchema.parse(req.body);

    const patch = {
      sectors: input.sectors,
      role: input.role,
      goals: input.goals,
      emailFrequency: input.email_frequency,
      updatedAt: new Date(),
      ...(input.email_unsubscribed !== undefined
        ? { emailUnsubscribed: input.email_unsubscribed }
        : {}),
      ...(input.depth_preference !== undefined
        ? { depthPreference: input.depth_preference }
        : {}),
    };

    const profile = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ userId: userProfiles.userId })
        .from(userProfiles)
        .where(eq(userProfiles.userId, userId))
        .limit(1);

      if (existing) {
        const [updated] = await tx
          .update(userProfiles)
          .set(patch)
          .where(eq(userProfiles.userId, userId))
          .returning();
        return updated;
      }

      const [inserted] = await tx
        .insert(userProfiles)
        .values({ userId, ...patch })
        .returning();
      return inserted;
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
