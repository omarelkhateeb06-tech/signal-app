// Phase 12c — per-user, per-story commentary orchestrator.
//
// Cache-miss path:
//   1. Load user_profiles + user_topic_interests for this user.
//   2. Compute matched_interests (sector overlap + in-sector topics).
//   3. Build the Haiku prompt.
//   4. Call Haiku. Success → check banned phrases → on pass, insert
//      into commentary_cache and return. Any failure → tiered
//      fallback (not cached).
//   5. Anomaly log when Tier 3 fires, whatever the cause.
//
// Cache-hit path:
//   1. Update last_accessed_at to now(). See LAST_ACCESSED_UPDATE_MODE
//      below — in 12c we do this on every hit; 12c.1 may batch.
//   2. Return the cached commentary.
//
// Cache key is (userId, storyId, depth, profileVersion). `depth`
// comes in as the user's declared depth_preference or an explicit
// override on the /commentary route (e.g. a Premium user toggling the
// depth selector on story detail).

import { and, eq } from "drizzle-orm";
import type { db as DbType } from "../db";
import {
  commentaryCache,
  stories,
  userProfiles,
  userTopicInterests,
  type DepthLevel,
} from "../db/schema";
import {
  buildFallbackCommentary,
  checkBannedPhrases,
  type FallbackResult,
  type Tier3Reason,
} from "./commentaryFallback";
import { buildCommentaryPrompt } from "./commentaryPrompt";
import {
  callHaikuForCommentary,
  type HaikuClientDeps,
  type HaikuFailureReason,
} from "./haikuCommentaryClient";
import { computeMatchedInterests } from "../utils/matchedInterests";

// 12c decision: update last_accessed_at on every cache hit. This lets
// a future LRU-style GC job (12c.1) prune cold rows using real access
// recency, not just generated_at. It's one extra UPDATE per feed row
// — cheap, unindexed write, but if it shows up in load testing we'll
// batch into a per-request deduped write-through in 12c.1. TODO: see
// 12c.1 opportunistic-update proposal.
const LAST_ACCESSED_UPDATE_MODE = "every_hit" as const;

export interface CommentaryServiceDeps {
  db: typeof DbType;
  haiku?: HaikuClientDeps;
  // Structured logger. Tests substitute a jest.fn(); production wiring
  // uses a console.log-based shim until we formalize a pino/Sentry
  // pipe for commentary events.
  logger?: Pick<Console, "info" | "warn" | "error">;
  // Clock injection for deterministic generated_at / last_accessed_at
  // in tests. Defaults to Date.now().
  now?: () => Date;
}

export interface GetOrGenerateInput {
  userId: string;
  storyId: string;
  depth: DepthLevel;
  // Snapshot of the user's profile_version at request time. The
  // caller (controller) reads it off user_profiles in the same
  // transaction that issued the request so a concurrent Settings
  // update can't cause a stale-cache read.
  profileVersion: number;
}

export interface CommentaryResult {
  commentary: string;
  depth: DepthLevel;
  profileVersion: number;
  // Source identifies which path produced the text. "haiku" is the
  // happy path; "cache" is a hit; the three "fallback_*" variants
  // tell the feed route this commentary is deterministic and
  // should not be cached (it already wasn't — only successful Haiku
  // output is inserted into commentary_cache — but the client may
  // want to retry-on-next-view with different semantics).
  source:
    | "cache"
    | "haiku"
    | "fallback_tier1"
    | "fallback_tier2"
    | "fallback_tier3";
}

// Map the low-level Haiku failure reason into the Tier 3 anomaly
// vocabulary. Kept in this layer because the fallback module doesn't
// know about the Haiku client and shouldn't.
function haikuReasonToTier3(reason: HaikuFailureReason): Tier3Reason {
  switch (reason) {
    case "timeout":
      return "haiku_timeout";
    case "empty":
      return "haiku_empty";
    case "api_error":
      return "haiku_api_error";
    case "no_api_key":
      return "haiku_no_api_key";
  }
}

/**
 * Orchestrator. Cache-first, Haiku on miss, tiered fallback on any
 * Haiku-side failure. Returns a structured result so the controller
 * can project `source` into telemetry without re-deriving it.
 */
export async function getOrGenerateCommentary(
  input: GetOrGenerateInput,
  deps: CommentaryServiceDeps,
): Promise<CommentaryResult> {
  const logger = deps.logger ?? console;
  const now = deps.now ?? ((): Date => new Date());

  // ---- 1. Cache lookup ----
  const [hit] = await deps.db
    .select()
    .from(commentaryCache)
    .where(
      and(
        eq(commentaryCache.userId, input.userId),
        eq(commentaryCache.storyId, input.storyId),
        eq(commentaryCache.depth, input.depth),
        eq(commentaryCache.profileVersion, input.profileVersion),
      ),
    )
    .limit(1);

  if (hit) {
    // 12c: update last_accessed_at on every hit. See
    // LAST_ACCESSED_UPDATE_MODE comment.
    if (LAST_ACCESSED_UPDATE_MODE === "every_hit") {
      await deps.db
        .update(commentaryCache)
        .set({ lastAccessedAt: now() })
        .where(eq(commentaryCache.id, hit.id));
    }
    return {
      commentary: hit.commentary,
      depth: input.depth,
      profileVersion: input.profileVersion,
      source: "cache",
    };
  }

  // ---- 2. Gather story + profile context for the prompt ----
  const [story] = await deps.db
    .select({
      id: stories.id,
      sector: stories.sector,
      headline: stories.headline,
      context: stories.context,
      whyItMatters: stories.whyItMatters,
    })
    .from(stories)
    .where(eq(stories.id, input.storyId))
    .limit(1);
  if (!story) {
    // Caller should have validated this, but surface a deterministic
    // error rather than letting Haiku hallucinate against an unknown
    // headline. Controller maps this to 404.
    throw new Error(`story not found: ${input.storyId}`);
  }

  const [profile] = await deps.db
    .select({
      role: userProfiles.role,
      domain: userProfiles.domain,
      seniority: userProfiles.seniority,
      sectors: userProfiles.sectors,
      goals: userProfiles.goals,
    })
    .from(userProfiles)
    .where(eq(userProfiles.userId, input.userId))
    .limit(1);

  const topicRows = await deps.db
    .select({ sector: userTopicInterests.sector, topic: userTopicInterests.topic })
    .from(userTopicInterests)
    .where(eq(userTopicInterests.userId, input.userId));

  const matched = computeMatchedInterests({
    storySector: story.sector,
    userSectors: profile?.sectors ?? null,
    userTopicsForSector: topicRows,
  });

  const profileShape = {
    role: profile?.role ?? null,
    domain: profile?.domain ?? null,
    seniority: profile?.seniority ?? null,
    sectors: profile?.sectors ?? null,
    goals: profile?.goals ?? null,
  };

  // ---- 3. Call Haiku ----
  const prompt = buildCommentaryPrompt({
    depth: input.depth,
    profile: profileShape,
    matchedTopics: matched.matchedTopics,
    story,
  });

  const result = await callHaikuForCommentary(prompt, deps.haiku);

  // ---- 4a. Haiku succeeded — banned-phrase gate, then insert ----
  if (result.ok) {
    const banCheck = checkBannedPhrases(result.text);
    if (banCheck.clean) {
      const [row] = await deps.db
        .insert(commentaryCache)
        .values({
          userId: input.userId,
          storyId: input.storyId,
          depth: input.depth,
          profileVersion: input.profileVersion,
          commentary: result.text,
          generatedAt: now(),
          lastAccessedAt: now(),
        })
        // onConflictDoNothing handles the narrow race where two
        // concurrent cache-miss requests for the same key try to
        // insert simultaneously. The bare form suffices — there's
        // only one unique constraint on the table beyond the PK, so
        // "any conflict" and "conflict on (userId, storyId, depth,
        // profileVersion)" are equivalent here. The second insert is
        // a no-op; the second caller falls through to the next read
        // below (which will hit the now-populated row).
        .onConflictDoNothing()
        .returning();
      // If the insert was pre-empted by another request, the returning
      // clause is empty — re-read to get the canonical row.
      if (row) {
        return {
          commentary: row.commentary,
          depth: input.depth,
          profileVersion: input.profileVersion,
          source: "haiku",
        };
      }
      const [raced] = await deps.db
        .select()
        .from(commentaryCache)
        .where(
          and(
            eq(commentaryCache.userId, input.userId),
            eq(commentaryCache.storyId, input.storyId),
            eq(commentaryCache.depth, input.depth),
            eq(commentaryCache.profileVersion, input.profileVersion),
          ),
        )
        .limit(1);
      if (raced) {
        return {
          commentary: raced.commentary,
          depth: input.depth,
          profileVersion: input.profileVersion,
          source: "cache",
        };
      }
      // Truly unexpected — the insert returned no row AND the re-read
      // came up empty. Route through the fallback so the user still
      // gets deterministic commentary, but use a dedicated Tier 3
      // reason: stamping this as "haiku_banned_phrase" (the old
      // fall-through destination) would mislead operators investigating
      // the anomaly log. Unreachable in normal operation.
      return buildAndLogFallback(
        input,
        story,
        profileShape,
        matched,
        "cache_race_unexpected",
        logger,
        undefined,
      );
    }
    // Haiku text tripped the banned-phrase gate. Reroute to fallback
    // with an explicit reason so the Tier 3 anomaly log says why.
    return buildAndLogFallback(
      input,
      story,
      profileShape,
      matched,
      "haiku_banned_phrase",
      logger,
      { offenders: banCheck.offenders },
    );
  }

  // ---- 4b. Haiku failed — fall through to fallback ----
  return buildAndLogFallback(
    input,
    story,
    profileShape,
    matched,
    haikuReasonToTier3(result.reason),
    logger,
    result.reason === "api_error" && result.detail
      ? { detail: result.detail }
      : undefined,
  );
}

// Shared fallback-path emitter. Builds the fallback text, projects the
// tier into the source string, and emits the Tier 3 anomaly log
// exactly once per invocation.
function buildAndLogFallback(
  input: GetOrGenerateInput,
  story: { sector: string; headline: string; whyItMatters: string },
  profile: { role: string | null; domain: string | null; seniority: string | null },
  matched: { matchedSector: boolean; matchedTopics: string[] },
  haikuFailureReason: Tier3Reason | undefined,
  logger: Pick<Console, "info" | "warn" | "error">,
  extra: { offenders?: string[]; detail?: string } | undefined,
): CommentaryResult {
  const fb: FallbackResult = buildFallbackCommentary({
    storyHeadline: story.headline,
    storySector: story.sector,
    storyWhyItMatters: story.whyItMatters,
    profile,
    matched: { matchedSector: matched.matchedSector, matchedTopics: matched.matchedTopics },
    haikuFailureReason,
  });

  if (fb.anomaly) {
    // One structured warn per fallback invocation. `event` field is
    // stable so dashboards / log filters key off it directly.
    logger.warn({
      ...fb.anomaly,
      userId: input.userId,
      storyId: input.storyId,
      depth: input.depth,
      profileVersion: input.profileVersion,
      ...(extra?.offenders ? { haikuOffenders: extra.offenders } : {}),
      ...(extra?.detail ? { haikuErrorDetail: extra.detail } : {}),
    });
  }

  const source =
    fb.tier === "tier1"
      ? ("fallback_tier1" as const)
      : fb.tier === "tier2"
        ? ("fallback_tier2" as const)
        : ("fallback_tier3" as const);

  return {
    commentary: fb.text,
    depth: input.depth,
    profileVersion: input.profileVersion,
    source,
  };
}
