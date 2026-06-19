// "The Through-Line" — daily editorial-synthesis endpoint, open to every
// authenticated reader.
//
// Route: GET /api/v1/briefing/through-line?storyIds=<comma uuids>
// Auth:  requireAuth
//
// Response (all under the standard `{ data: ... }` envelope):
//   success    → { through_line, source: "haiku" }
//   no result  → { through_line: null, source: "unavailable" }
//
// The Through-Line switch-up (D3) made the daily read the FREE hook —
// every tier gets it. The paywall now sits on depth tiers + per-story
// personalized commentary + feed breadth, not on the read itself.
//
// Cost discipline: Redis is the daily cache AND the cost fuse. When
// Redis is unconfigured / unreachable we SKIP generation entirely and
// return "unavailable" — mirroring the §7 "re-enrichment skipped when
// REDIS_URL unset" fail-open-on-cost convention. With Redis up, the
// per-(user, profile_version, utc-date) cache bounds Haiku to ≤1 call
// per reader per day.

import type { NextFunction, Request, Response } from "express";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { events, stories, userProfiles } from "../db/schema";
import { AppError } from "../middleware/errorHandler";
import { getRedis, isRedisConfigured } from "../lib/redis";
import {
  generateThroughLine,
  type ThroughLineStory,
} from "../services/throughLineService";

// storyIds: comma-separated, 1–10 UUIDs. Parsed from the raw query
// string then validated as a UUID array; a malformed entry is mapped to
// a clean AppError("INVALID_QUERY") in the controller rather than a 500.
const querySchema = z.object({
  storyIds: z
    .string()
    .transform((raw) =>
      raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    )
    .pipe(z.array(z.string().uuid()).min(1).max(10)),
});

function requireUserId(req: Request): string {
  if (!req.user) {
    throw new AppError("UNAUTHORIZED", "Not authenticated", 401);
  }
  return req.user.userId;
}

// Seconds from now until the next UTC midnight. Anchors the cache TTL so
// the Through-Line rolls over with the UTC day, same as the paywall
// counters.
function secondsUntilUtcMidnight(now: Date): number {
  const next = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
      0,
      0,
      0,
      0,
    ),
  );
  return Math.max(1, Math.ceil((next.getTime() - now.getTime()) / 1000));
}

function utcDateKey(now: Date): string {
  return now.toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * GET /api/v1/briefing/through-line
 */
export async function getThroughLine(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const parseResult = querySchema.safeParse(req.query);
    if (!parseResult.success) {
      throw new AppError(
        "INVALID_QUERY",
        "Invalid query parameters",
        400,
        parseResult.error.flatten(),
      );
    }
    const { storyIds } = parseResult.data;

    // ---- Cost fuse: no Redis → no generation ----
    // Redis is both the daily cache and the per-reader cost cap. Without
    // it we cannot bound Haiku spend to ≤1 call/reader/day, so we decline
    // to generate rather than fail open on cost (§7 convention).
    if (!isRedisConfigured()) {
      res.json({ data: { through_line: null, source: "unavailable" } });
      return;
    }
    const redis = getRedis();
    if (!redis) {
      res.json({ data: { through_line: null, source: "unavailable" } });
      return;
    }

    // ---- Profile (for cache key + prompt) ----
    const [profile] = await db
      .select({
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

    // Pre-onboarding users have no profile row. Match the commentary
    // endpoint: a deterministic 400 rather than a degraded synthesis.
    if (!profile) {
      throw new AppError(
        "PROFILE_NOT_FOUND",
        "Complete onboarding to see the Through-Line",
        400,
      );
    }

    const now = new Date();
    const cacheKey = `valo:through-line:${userId}:${profile.profileVersion}:${utcDateKey(now)}`;

    // ---- Cache lookup. Redis errors fail to "unavailable" (cost-safe). ----
    let cached: string | null;
    try {
      cached = await redis.get(cacheKey);
    } catch {
      res.json({ data: { through_line: null, source: "unavailable" } });
      return;
    }
    if (cached) {
      res.json({ data: { through_line: cached, source: "haiku" } });
      return;
    }

    // ---- Load the day's top stories (events first, stories fallback) ----
    const resolved = await loadStories(storyIds);
    if (resolved.length === 0) {
      res.json({ data: { through_line: null, source: "unavailable" } });
      return;
    }

    // ---- Generate ----
    const throughLine = await generateThroughLine({
      stories: resolved,
      profile: {
        role: profile.role ?? null,
        domain: profile.domain ?? null,
        seniority: profile.seniority ?? null,
        sectors: profile.sectors ?? null,
        goals: profile.goals ?? null,
      },
    });

    if (!throughLine) {
      res.json({ data: { through_line: null, source: "unavailable" } });
      return;
    }

    // ---- Cache (TTL = seconds to next UTC midnight). Best-effort. ----
    try {
      await redis.set(cacheKey, throughLine, "EX", secondsUntilUtcMidnight(now));
    } catch {
      // Cache write failed — still return the freshly-generated line.
      // The next request re-generates (one extra call); acceptable.
    }

    res.json({ data: { through_line: throughLine, source: "haiku" } });
  } catch (error) {
    next(error);
  }
}

/**
 * Resolve the requested ids to {headline, gist}, preserving request
 * order. Reads events (the ingested source) first, then the legacy
 * stories table for any id that didn't resolve there. Ids that resolve
 * to neither are silently dropped.
 */
async function loadStories(storyIds: string[]): Promise<ThroughLineStory[]> {
  const byId = new Map<string, ThroughLineStory>();

  const eventRows = await db
    .select({
      id: events.id,
      headline: events.headline,
      whyItMatters: events.whyItMatters,
      genericCommentary: events.genericCommentary,
    })
    .from(events)
    .where(inArray(events.id, storyIds));
  for (const r of eventRows) {
    byId.set(r.id, {
      headline: r.headline,
      gist: gistFor(r.whyItMatters, r.genericCommentary),
    });
  }

  const missing = storyIds.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    const storyRows = await db
      .select({
        id: stories.id,
        headline: stories.headline,
        whyItMatters: stories.whyItMatters,
        genericCommentary: stories.genericCommentary,
      })
      .from(stories)
      .where(inArray(stories.id, missing));
    for (const r of storyRows) {
      byId.set(r.id, {
        headline: r.headline,
        gist: gistFor(r.whyItMatters, r.genericCommentary),
      });
    }
  }

  // Preserve the frontend's ranked order; drop unresolved ids.
  return storyIds
    .map((id) => byId.get(id))
    .filter((s): s is ThroughLineStory => s !== undefined);
}

// One-line gist: generic_commentary (role-neutral, free-tier text)
// preferred, why_it_matters as the fallback. First sentence only, to
// keep the prompt tight.
function gistFor(whyItMatters: string, genericCommentary: string | null): string {
  const source = (genericCommentary?.trim() || whyItMatters).trim();
  const breakIdx = source.search(/[.!?\n]/);
  const slice = breakIdx > 0 ? source.slice(0, breakIdx + 1) : source;
  return slice.slice(0, 200).trim();
}
