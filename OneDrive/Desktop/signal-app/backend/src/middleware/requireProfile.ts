import type { NextFunction, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { userProfiles } from "../db/schema";
import { AppError } from "./errorHandler";

/**
 * Defense-in-depth: refuse to serve feed-surface routes until the
 * authenticated user has completed the Phase 12b onboarding
 * questionnaire. The frontend enforces this via `useRequireOnboarded`,
 * but we don't trust the client — a curl with a valid JWT for a
 * half-onboarded user still must not be able to pull the feed.
 *
 * Predicate: a profile row exists AND `completed_at IS NOT NULL`. The
 * unsubscribe flow creates a profile row eagerly, so "row exists"
 * alone is NOT sufficient evidence of a completed questionnaire.
 *
 * Must be mounted AFTER `requireAuth` — it reads `req.user.userId`.
 * On reject: 403 ONBOARDING_REQUIRED (not 401; the user IS
 * authenticated, they just haven't finished the required flow).
 */
export async function requireProfile(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError("UNAUTHORIZED", "Not authenticated", 401);
    }

    const [row] = await db
      .select({ completedAt: userProfiles.completedAt })
      .from(userProfiles)
      .where(eq(userProfiles.userId, req.user.userId))
      .limit(1);

    if (!row || row.completedAt === null) {
      throw new AppError(
        "ONBOARDING_REQUIRED",
        "Complete onboarding before accessing this resource",
        403,
      );
    }

    next();
  } catch (error) {
    next(error);
  }
}
