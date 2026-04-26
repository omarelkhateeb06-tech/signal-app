// Phase 12c — per-user, per-story commentary orchestrator.
// Phase 12d — JSON-shaped Haiku output `{thesis, support}` + four-stage
// JSON enforcement (prompt instruction, one-shot example, assistant
// prefill, service-layer parse-and-retry-with-fallback).
//
// Cache-miss path:
//   1. Load user_profiles + user_topic_interests for this user.
//   2. Compute matched_interests (sector overlap + in-sector topics).
//   3. Build the V2 expandable prompt.
//   4. Call Haiku with `assistantPrefill = "{"`.
//   5. parseCommentaryJson on the prefilled text.
//        ok       → continue.
//        not ok   → ONE retry of step 4 (same prompt, same prefill).
//                   second failure → fallback (tier3, json_parse | json_shape).
//   6. checkBannedPhrases on (thesis + support).
//        not clean → fallback (tier3, haiku_banned_phrase).
//   7. checkBannedOpeners on {thesis, support}.
//        not clean → fallback (tier3, haiku_banned_opener).
//   8. validateWordBudgets — log warnings, never reject.
//   9. Insert `{thesis, support}` jsonb row → return source:"haiku".
//
// Cache-hit path:
//   1. Update last_accessed_at to now() (every_hit mode in 12c).
//   2. Return the cached commentary.
//
// Cache key is (userId, storyId, depth, profileVersion) — unchanged
// across 12c → 12d. Expand/collapse is pure frontend session state per
// Decision 12d.3 and so does not enter the cache key.

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
  checkBannedOpeners,
  checkBannedPhrases,
  type FallbackResult,
  type Tier3Reason,
} from "./commentaryFallback";
import {
  buildExpandableCommentaryPrompt,
  COMMENTARY_PREFILL,
  getWordBudgets,
} from "./commentaryPromptV2";
import {
  callHaikuForCommentary,
  type HaikuClientDeps,
  type HaikuFailureReason,
  type HaikuResult,
} from "./haikuCommentaryClient";
import {
  parseCommentaryJson,
  type CommentaryParseResult,
  type ParsedCommentary,
} from "./commentaryJsonParser";
import {
  validateWordBudgets,
  type WordCountWarning,
} from "./commentaryWordCount";
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

// 12d — wire shape for both Haiku output and fallback output. Frontend
// renders thesis by default; "Go deeper" reveals support.
export interface CommentaryShape {
  thesis: string;
  support: string;
}

export interface CommentaryResult {
  commentary: CommentaryShape;
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

function parseFailureToTier3(
  reason: "json_parse" | "json_shape",
): Tier3Reason {
  return reason === "json_parse" ? "haiku_json_parse" : "haiku_json_shape";
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
    if (LAST_ACCESSED_UPDATE_MODE === "every_hit") {
      await deps.db
        .update(commentaryCache)
        .set({ lastAccessedAt: now() })
        .where(eq(commentaryCache.id, hit.id));
    }
    // jsonb $type<{thesis, support}>() means hit.commentary already
    // arrives typed at the column level — no parse step on cache hits.
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

  // ---- 3. Build the V2 prompt ----
  const prompt = buildExpandableCommentaryPrompt({
    depth: input.depth,
    profile: profileShape,
    matchedTopics: matched.matchedTopics,
    story,
  });

  // ---- 4 & 5. Call + parse, with one parse-failure retry ----
  const callOpts = { assistantPrefill: COMMENTARY_PREFILL };
  let haiku: HaikuResult = await callHaikuForCommentary(
    prompt,
    deps.haiku,
    callOpts,
  );

  // Transport failure (timeout, empty, api_error, no_api_key) — no
  // retry, fall through to fallback.
  if (!haiku.ok) {
    return buildAndLogFallback(
      input,
      story,
      profileShape,
      matched,
      haikuReasonToTier3(haiku.reason),
      logger,
      haiku.reason === "api_error" && haiku.detail
        ? { detail: haiku.detail }
        : undefined,
    );
  }

  let parsed: CommentaryParseResult = parseCommentaryJson(haiku.text);
  let retried = false;
  if (!parsed.ok) {
    // One retry on parse failure. Same prompt, same prefill — the
    // model's vocabulary preference is unlikely to flip on retry, but
    // intermittent JSON-shape glitches (truncation, an extra leading
    // token) sometimes do. If the retry's transport fails, we surface
    // the parse reason from the original attempt — that's the more
    // diagnostic of the two failure modes.
    retried = true;
    haiku = await callHaikuForCommentary(prompt, deps.haiku, callOpts);
    if (!haiku.ok) {
      return buildAndLogFallback(
        input,
        story,
        profileShape,
        matched,
        haikuReasonToTier3(haiku.reason),
        logger,
        {
          retried: true,
          ...(haiku.reason === "api_error" && haiku.detail
            ? { detail: haiku.detail }
            : {}),
        },
      );
    }
    parsed = parseCommentaryJson(haiku.text);
  }

  if (!parsed.ok) {
    return buildAndLogFallback(
      input,
      story,
      profileShape,
      matched,
      parseFailureToTier3(parsed.reason),
      logger,
      {
        retried,
        rawSample: parsed.rawSample,
        ...(parsed.missingFields ? { missingFields: parsed.missingFields } : {}),
      },
    );
  }

  const commentary: ParsedCommentary = parsed.value;

  // ---- 6. Banned-phrase gate (substring anywhere in thesis+support) ----
  const banCheck = checkBannedPhrases(`${commentary.thesis}\n${commentary.support}`);
  if (!banCheck.clean) {
    return buildAndLogFallback(
      input,
      story,
      profileShape,
      matched,
      "haiku_banned_phrase",
      logger,
      { offenders: banCheck.offenders, retried },
    );
  }

  // ---- 7. Banned-opener gate (positional, per-field) ----
  const openerCheck = checkBannedOpeners(commentary);
  if (!openerCheck.clean) {
    return buildAndLogFallback(
      input,
      story,
      profileShape,
      matched,
      "haiku_banned_opener",
      logger,
      { openerOffenders: openerCheck.offenders, retried },
    );
  }

  // ---- 8. Word-budget validator (warn-only, never reject) ----
  const warnings = validateWordBudgets(commentary, getWordBudgets(input.depth));
  if (warnings.length > 0) {
    emitWordBudgetWarnings(input, warnings, logger);
  }

  // ---- 9. Insert ----
  const [row] = await deps.db
    .insert(commentaryCache)
    .values({
      userId: input.userId,
      storyId: input.storyId,
      depth: input.depth,
      profileVersion: input.profileVersion,
      commentary,
      generatedAt: now(),
      lastAccessedAt: now(),
    })
    // onConflictDoNothing handles the narrow race where two concurrent
    // cache-miss requests for the same key try to insert simultaneously.
    .onConflictDoNothing()
    .returning();
  if (row) {
    return {
      commentary: row.commentary,
      depth: input.depth,
      profileVersion: input.profileVersion,
      source: "haiku",
    };
  }
  // Pre-empted by a concurrent insert — re-read the canonical row.
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
  // Truly unexpected — neither insert nor re-read produced a row.
  return buildAndLogFallback(
    input,
    story,
    profileShape,
    matched,
    "cache_race_unexpected",
    logger,
    { retried },
  );
}

interface FallbackLogExtras {
  offenders?: string[];
  openerOffenders?: { field: "thesis" | "support"; pattern: string }[];
  detail?: string;
  retried?: boolean;
  rawSample?: string;
  missingFields?: readonly ("thesis" | "support")[];
}

// Shared fallback-path emitter. Builds the fallback commentary,
// projects the tier into the source string, and emits the Tier 3
// anomaly log exactly once per invocation. All log lines carry
// {userId, storyId, depth, profileVersion} as structured fields so
// dashboard filters can correlate by user/story/depth without regex
// parsing.
function buildAndLogFallback(
  input: GetOrGenerateInput,
  story: { sector: string; headline: string; whyItMatters: string },
  profile: { role: string | null; domain: string | null; seniority: string | null },
  matched: { matchedSector: boolean; matchedTopics: string[] },
  haikuFailureReason: Tier3Reason | undefined,
  logger: Pick<Console, "info" | "warn" | "error">,
  extra: FallbackLogExtras | undefined,
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
    logger.warn({
      ...fb.anomaly,
      userId: input.userId,
      storyId: input.storyId,
      depth: input.depth,
      profileVersion: input.profileVersion,
      ...(extra?.offenders ? { haikuOffenders: extra.offenders } : {}),
      ...(extra?.openerOffenders
        ? { haikuOpenerOffenders: extra.openerOffenders }
        : {}),
      ...(extra?.detail ? { haikuErrorDetail: extra.detail } : {}),
      ...(extra?.retried !== undefined ? { retried: extra.retried } : {}),
      ...(extra?.rawSample ? { rawSample: extra.rawSample } : {}),
      ...(extra?.missingFields
        ? { missingFields: extra.missingFields }
        : {}),
    });
  }

  const source =
    fb.tier === "tier1"
      ? ("fallback_tier1" as const)
      : fb.tier === "tier2"
        ? ("fallback_tier2" as const)
        : ("fallback_tier3" as const);

  return {
    commentary: fb.commentary,
    depth: input.depth,
    profileVersion: input.profileVersion,
    source,
  };
}

// Word-budget warnings are observability only — we don't reject the
// commentary, but each drift event is logged so dashboards can pick
// up persistent over- or under-budget output across a depth tier.
function emitWordBudgetWarnings(
  input: GetOrGenerateInput,
  warnings: WordCountWarning[],
  logger: Pick<Console, "info" | "warn" | "error">,
): void {
  for (const w of warnings) {
    logger.warn({
      event: "commentary_word_budget_drift",
      userId: input.userId,
      storyId: input.storyId,
      depth: input.depth,
      profileVersion: input.profileVersion,
      field: w.field,
      direction: w.direction,
      actualWords: w.actualWords,
      budgetWords: w.budgetWords,
      driftRatio: Number(w.driftRatio.toFixed(3)),
    });
  }
}
