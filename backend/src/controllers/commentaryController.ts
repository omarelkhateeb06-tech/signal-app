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
import { events, stories, userProfiles, DEPTH_LEVELS, type DepthLevel } from "../db/schema";
import { AppError } from "../middleware/errorHandler";
import { resolveEffectiveTier } from "../middleware/requireTier";
import { getOrGenerateCommentary } from "../services/commentaryService";
import { buildGatePayload, teaserFirstLine } from "../services/paywallService";

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

    // Phase 12g — tier resolution (also lazy-downgrades expired
    // pro_trial → free). Free users are restricted to `accessible`
    // depth; an explicit `?depth=briefed|technical` from a free user
    // is gated with reason="depth" instead of generating commentary.
    const { tier, trialStartedAt } = await resolveEffectiveTier(userId);
    const trialAvailable = !trialStartedAt;
    const requestedHigherDepth =
      depthOverride === "briefed" || depthOverride === "technical";

    if (tier === "free" && requestedHigherDepth) {
      // Fetch the headline + why_it_matters for the gate teaser. Try
      // stories first, fall back to events (mirroring the dual-read
      // pattern of getStoryById). A missing story still emits 404 —
      // the gate is only meaningful for an existing story.
      const [storyRow] = await db
        .select({
          headline: stories.headline,
          whyItMatters: stories.whyItMatters,
          genericCommentary: stories.genericCommentary,
        })
        .from(stories)
        .where(eq(stories.id, storyId))
        .limit(1);
      let headline: string;
      let whyItMatters: string;
      let genericCommentary: string | null;
      if (storyRow) {
        headline = storyRow.headline;
        whyItMatters = storyRow.whyItMatters;
        genericCommentary = storyRow.genericCommentary;
      } else {
        const [eventRow] = await db
          .select({
            headline: events.headline,
            whyItMatters: events.whyItMatters,
            genericCommentary: events.genericCommentary,
          })
          .from(events)
          .where(eq(events.id, storyId))
          .limit(1);
        if (!eventRow) {
          throw new AppError("STORY_NOT_FOUND", "Story not found", 404);
        }
        headline = eventRow.headline;
        whyItMatters = eventRow.whyItMatters;
        genericCommentary = eventRow.genericCommentary;
      }
      const payload = buildGatePayload(
        "depth",
        headline,
        teaserFirstLine(whyItMatters, genericCommentary),
        trialAvailable,
      );
      res.json({ data: payload });
      return;
    }

    // Phase 12g — free users skip the personalized Haiku path entirely
    // and read the pre-generated role-neutral commentary from the row.
    // This makes the free-tier path zero-latency, zero-cost, and (since
    // the column is the same content all free users see) hits no per-
    // user cache. Falls back to why_it_matters when the column is null
    // (pre-12g rows that the backfill hasn't filled).
    if (tier === "free") {
      const [storyTextRow] = await db
        .select({
          whyItMatters: stories.whyItMatters,
          genericCommentary: stories.genericCommentary,
        })
        .from(stories)
        .where(eq(stories.id, storyId))
        .limit(1);
      let whyItMatters: string | undefined;
      let genericCommentary: string | null = null;
      if (storyTextRow) {
        whyItMatters = storyTextRow.whyItMatters;
        genericCommentary = storyTextRow.genericCommentary;
      } else {
        const [eventTextRow] = await db
          .select({
            whyItMatters: events.whyItMatters,
            genericCommentary: events.genericCommentary,
          })
          .from(events)
          .where(eq(events.id, storyId))
          .limit(1);
        if (!eventTextRow) {
          throw new AppError("STORY_NOT_FOUND", "Story not found", 404);
        }
        whyItMatters = eventTextRow.whyItMatters;
        genericCommentary = eventTextRow.genericCommentary;
      }
      const text = genericCommentary?.trim() || whyItMatters;
      res.json({
        data: {
          commentary: { thesis: text, support: "" },
          depth: "accessible" as const,
          profile_version: 0,
          source: "generic" as const,
        },
      });
      return;
    }

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
    // "accessible" as the last-resort default. The default exists
    // because early-onboarding users may not have saved a depth yet;
    // the onboarding flow makes it mandatory but a direct API caller
    // could bypass. See §9 of CLAUDE.md — "accessible" is the free-tier
    // default and the right floor here. (Free users branched off above
    // — this code only runs for pro / pro_trial.)
    const depth: DepthLevel =
      depthOverride ?? profile.depthPreference ?? "accessible";

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
