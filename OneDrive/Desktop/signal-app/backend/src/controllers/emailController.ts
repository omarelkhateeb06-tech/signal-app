import type { NextFunction, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { userProfiles, users } from "../db/schema";
import { AppError } from "../middleware/errorHandler";
import { verifyUnsubscribeToken } from "../services/unsubscribeService";

const unsubscribeSchema = z.object({
  token: z.string().min(1),
});

const preferencesSchema = z.object({
  email_frequency: z.enum(["daily", "weekly", "never"]).optional(),
  email_unsubscribed: z.boolean().optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: "Provide at least one preference to update",
});

function requireUserId(req: Request): string {
  if (!req.user) throw new AppError("UNAUTHORIZED", "Not authenticated", 401);
  return req.user.userId;
}

export async function unsubscribe(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = typeof req.body?.token === "string" ? req.body.token : req.query.token;
    const parsed = unsubscribeSchema.parse({ token });
    const verified = verifyUnsubscribeToken(parsed.token);
    if (!verified) {
      throw new AppError("INVALID_TOKEN", "Invalid or expired unsubscribe link", 400);
    }

    const [user] = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.id, verified.userId))
      .limit(1);
    if (!user) {
      throw new AppError("USER_NOT_FOUND", "Account not found", 404);
    }

    await db
      .insert(userProfiles)
      .values({ userId: user.id, emailUnsubscribed: true })
      .onConflictDoUpdate({
        target: userProfiles.userId,
        set: { emailUnsubscribed: true, updatedAt: new Date() },
      });

    res.json({ data: { email: user.email, unsubscribed: true } });
  } catch (error) {
    next(error);
  }
}

export async function updateEmailPreferences(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const input = preferencesSchema.parse(req.body);

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.email_frequency !== undefined) patch.emailFrequency = input.email_frequency;
    if (input.email_unsubscribed !== undefined) patch.emailUnsubscribed = input.email_unsubscribed;

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
      throw new AppError("PREFERENCES_UPDATE_FAILED", "Failed to update email preferences", 500);
    }

    res.json({
      data: {
        profile: {
          email_frequency: profile.emailFrequency,
          email_unsubscribed: profile.emailUnsubscribed,
        },
      },
    });
  } catch (error) {
    next(error);
  }
}
