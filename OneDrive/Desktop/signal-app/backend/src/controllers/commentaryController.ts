// Phase 12c — per-story commentary endpoint.
//
// Shape is deliberately thin: the controller validates input, loads
// the user's current profileVersion + depthPreference, delegates to
// getOrGenerateCommentary, and projects the service result onto a
// stable JSON envelope. All of the cache-first / Haiku / fallback
// logic lives in services/commentaryService.ts.
//
// Route: GET /api/v1/stories/:id/commentary(?depth=...)
// Auth:  requireAuth (same as the rest of /stories)
// Notes: depth gating (who can request which depth) is a 12f paywall
// concern. In 12c the override is accepted unconditionally so
// Premium's depth selector on story detail can exercise the full
// surface before the paywall lands.

import type { NextFunction, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { userProfiles, DEPTH_LEVELS, type DepthLevel } from "../db/schema";
import { AppError } from "../middleware/errorHandler";
import { getOrGenerateCommentary } from "../services/commentaryService";

const idParamSchema = z.object({ id: z.string().uuid() });

const querySchema = z.object({
  depth: z.enum(DEPTH_LEVELS).optional(),
});

function requireUserId(req: Request): string {
  if (!req.user) {
    throw new AppError("UNAUTHORIZED", "Not authenticated", 401);
  }
  return req.user.userId;
}

/**
 * GET /api/v1/stories/:id/commentary
 * Response: { data: { commentary, depth, profile_version, source } }
 *
 * `source` mirrors CommentaryResult.source from commentaryService:
 *   "cache" | "haiku" | "fallback_tier1" | "fallback_tier2" | "fallback_tier3"
 * The client uses it for display affordances (e.g. "generating…" vs
 * "from your signal") and for retry semantics on fallback rows.
 */
export async function getCommentary(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id: storyId } = idParamSchema.parse(req.params);
    const { depth: depthOverride } = querySchema.parse(req.query);

    // Load the user's depth_preference + profile_version in a single
    // read. profileVersion is the cache-key input — reading it in the
    // same tick the request is handled means a concurrent Settings
    // write (which bumps the version) lands on a different cache row,
    // not a stale one.
    const [profile] = await db
      .select({
        depthPreference: userProfiles.depthPreference,
        profileVersion: userProfiles.profileVersion,
      })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .limit(1);

    if (!profile) {
      // Pre-onboarding users shouldn't hit the feed endpoint (requireProfile
      // gates that surface), but direct story-detail links can land them
      // here. Surface a deterministic 400 — the client's onboarding redirect
      // will kick in on the next navigation.
      throw new AppError(
        "PROFILE_NOT_FOUND",
        "Complete onboarding to see personalized commentary",
        400,
      );
    }

    // Depth precedence: explicit query override > stored preference >
    // "standard" as the last-resort default. The default exists because
    // early-onboarding users may not have saved a depth yet; the
    // onboarding flow makes it mandatory but a direct API caller
    // could bypass. See §9 of CLAUDE.md — "standard" is the free-tier
    // default and the right floor here.
    const depth: DepthLevel =
      depthOverride ?? profile.depthPreference ?? "standard";

    const result = await getOrGenerateCommentary(
      {
        userId,
        storyId,
        depth,
        profileVersion: profile.profileVersion,
      },
      { db },
    );

    res.json({
      data: {
        commentary: result.commentary,
        depth: result.depth,
        profile_version: result.profileVersion,
        source: result.source,
      },
    });
  } catch (error) {
    // The service layer throws a plain Error with "story not found:
    // <id>" when the storyId doesn't resolve. Map it to a proper 404
    // so the client can distinguish "missing story" from "we failed
    // to generate commentary for a real story" (the latter never
    // throws — it falls through to the deterministic template).
    if (error instanceof Error && error.message.startsWith("story not found:")) {
      next(new AppError("STORY_NOT_FOUND", "Story not found", 404));
      return;
    }
    next(error);
  }
}
