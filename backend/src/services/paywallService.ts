import * as Sentry from "@sentry/node";
import { getRedis } from "../lib/redis";

// Phase 12g — paywall service. Per-user daily story-view tracking +
// the gate-response builder used by detail and feed endpoints when a
// free user hits the cap.
//
// Storage: a Redis SET per `(user, UTC date)` containing the story /
// event IDs the user has viewed today. SET (not counter) so re-reading
// a story already counted doesn't burn another view, and so the feed
// endpoint can flag exactly which stories on the page would be gated
// for this user right now. TTL is set to next UTC midnight on first
// SADD; subsequent SADDs leave the TTL alone.
//
// Tier scope: only `free` users hit Redis. `pro` / `pro_trial` /
// unauthenticated never reach this service for cap-related calls — the
// caller branches on tier first.
//
// Fail-open: any Redis error (unavailable, timeout) returns
// "not gated, not viewed" so the response continues without the cap.
// Spec note from the 12g session: temporary generosity during a Redis
// outage is acceptable — not a security breach.
//
// Race-tolerance: the SISMEMBER → SCARD → SADD sequence is not atomic.
// Two concurrent requests from the same user at count = CAP-1 may both
// land a SADD and push the set to CAP+1. Acceptable: the bound is +1
// over the cap, only under sustained per-user parallelism, and matches
// the rate-limiter's tolerance (apiKeyRateLimit uses the same shape).
// A Lua script could close this but the win does not pay for the
// complexity at 15/day.

export const FREE_TIER_STORY_CAP = 15;
export const FREE_TIER_SEARCH_CAP = 3;

function utcDateKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function secondsUntilNextUtcMidnight(now: Date): number {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  // Floor of 60s — defensive against clock skew on a key that is about
  // to expire anyway; gives the SET at least a minute of life.
  return Math.max(60, Math.ceil((next.getTime() - now.getTime()) / 1000));
}

function viewedSetKey(userId: string, now: Date): string {
  return `paywall:stories:viewed:${userId}:${utcDateKey(now)}`;
}

export interface ViewedSetSnapshot {
  // Story / event IDs viewed today. Empty when Redis is unavailable.
  ids: Set<string>;
  // Cardinality of `ids` — pre-computed for the feed flagging path
  // which compares against FREE_TIER_STORY_CAP many times.
  count: number;
  // True when the SMEMBERS landed; false on Redis-down fail-open.
  // Callers use it to decide whether to render `gated: true` flags on
  // the feed (skip when false — without Redis we cannot tell whether a
  // story would be gated, so the conservative answer is "not gated").
  available: boolean;
}

/**
 * Read the user's viewed-today set in one round trip. Used by the feed
 * endpoint to flag each row's `gated` field without burning views.
 */
export async function getViewedStoryIds(
  userId: string,
  now: Date = new Date(),
): Promise<ViewedSetSnapshot> {
  const redis = getRedis();
  if (!redis) {
    return { ids: new Set(), count: 0, available: false };
  }
  try {
    const members = await redis.smembers(viewedSetKey(userId, now));
    return { ids: new Set(members), count: members.length, available: true };
  } catch (err) {
    Sentry.captureMessage("Paywall: Redis SMEMBERS failed (fail-open)", {
      level: "warning",
      extra: { userId, err: err instanceof Error ? err.message : String(err) },
    });
    return { ids: new Set(), count: 0, available: false };
  }
}

export interface StoryViewDecision {
  // True iff the cap is reached AND this story has not been viewed
  // today. Already-viewed re-reads pass with `gated: false`.
  gated: boolean;
  // True when the story was already in today's set — caller can skip
  // any view-recording side effects.
  alreadyViewed: boolean;
  // The count after this call (set size). 0 on Redis-down fail-open.
  newCount: number;
}

/**
 * Free-tier detail-endpoint path: check if this story has been viewed
 * today; if not, gate or admit based on the current set cardinality.
 * Admits silently bump the set + TTL. Saved-story bypass is the
 * caller's responsibility — recordOrCheckStoryView assumes the caller
 * has already decided the story is paywall-eligible.
 */
export async function recordOrCheckStoryView(
  userId: string,
  storyId: string,
  now: Date = new Date(),
): Promise<StoryViewDecision> {
  const redis = getRedis();
  if (!redis) {
    return { gated: false, alreadyViewed: false, newCount: 0 };
  }
  const key = viewedSetKey(userId, now);
  try {
    const isMember = await redis.sismember(key, storyId);
    if (isMember === 1) {
      const count = await redis.scard(key);
      return { gated: false, alreadyViewed: true, newCount: count };
    }
    const currentSize = await redis.scard(key);
    if (currentSize >= FREE_TIER_STORY_CAP) {
      return { gated: true, alreadyViewed: false, newCount: currentSize };
    }
    const added = await redis.sadd(key, storyId);
    if (added === 1 && currentSize === 0) {
      // First view of the day → anchor TTL to next UTC midnight.
      await redis.expire(key, secondsUntilNextUtcMidnight(now));
    } else if (added === 1) {
      // Defensive: if the key lost its TTL (e.g. recreated by a tool
      // that bypassed EXPIRE), re-anchor. SET[A,B] without TTL would
      // never expire and quietly leak.
      const ttl = await redis.ttl(key);
      if (ttl < 0) {
        await redis.expire(key, secondsUntilNextUtcMidnight(now));
      }
    }
    return {
      gated: false,
      alreadyViewed: false,
      newCount: currentSize + (added === 1 ? 1 : 0),
    };
  } catch (err) {
    Sentry.captureMessage("Paywall: Redis op failed (fail-open)", {
      level: "warning",
      extra: {
        userId,
        storyId,
        err: err instanceof Error ? err.message : String(err),
      },
    });
    return { gated: false, alreadyViewed: false, newCount: 0 };
  }
}

function searchCounterKey(userId: string, now: Date): string {
  return `paywall:searches:${userId}:${utcDateKey(now)}`;
}

export interface SearchDecision {
  gated: boolean;
  // The counter value after this call. 0 on Redis-down fail-open
  // (caller can treat as "no information").
  newCount: number;
}

/**
 * Free-tier search-endpoint path: monotonically increment the daily
 * search counter and return whether the request should be served. The
 * 4th and later attempts each turn return `gated: true` (the counter
 * is allowed to grow past the cap — only the threshold matters, and
 * not rolling back keeps this one Redis round-trip). TTL is anchored
 * to next UTC midnight on the first INCR of the day.
 */
export async function recordOrCheckSearch(
  userId: string,
  now: Date = new Date(),
): Promise<SearchDecision> {
  const redis = getRedis();
  if (!redis) {
    return { gated: false, newCount: 0 };
  }
  const key = searchCounterKey(userId, now);
  try {
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, secondsUntilNextUtcMidnight(now));
    }
    return {
      gated: count > FREE_TIER_SEARCH_CAP,
      newCount: count,
    };
  } catch (err) {
    Sentry.captureMessage("Paywall: Redis INCR (search) failed (fail-open)", {
      level: "warning",
      extra: { userId, err: err instanceof Error ? err.message : String(err) },
    });
    return { gated: false, newCount: 0 };
  }
}

export type GateReason = "story_limit" | "depth" | "search_limit";

export interface GateUpgradeCta {
  trial_available: boolean;
  message: string;
}

export interface GatePayload {
  gated: true;
  gate_reason: GateReason;
  teaser: { headline: string; first_line: string };
  upgrade_cta: GateUpgradeCta;
}

// Messages locked at the 12g session. Free-tier users who have not
// trialed see the trial-offer copy; expired-trial users see the price.
const UPGRADE_MESSAGE_TRIAL =
  "Get commentary tailored to your role. Try Pro free for 7 days.";
const UPGRADE_MESSAGE_NO_TRIAL = "Upgrade to Pro — $10/month";

export function buildUpgradeCta(trialAvailable: boolean): GateUpgradeCta {
  return {
    trial_available: trialAvailable,
    message: trialAvailable ? UPGRADE_MESSAGE_TRIAL : UPGRADE_MESSAGE_NO_TRIAL,
  };
}

export function buildGatePayload(
  reason: GateReason,
  headline: string,
  firstLine: string,
  trialAvailable: boolean,
): GatePayload {
  return {
    gated: true,
    gate_reason: reason,
    teaser: { headline, first_line: firstLine },
    upgrade_cta: buildUpgradeCta(trialAvailable),
  };
}

/**
 * Search-limit gate. Teaser is static — there's no story context to
 * pull from, and the frontend renders the modal copy from
 * `upgrade_cta.message` plus a constant prefix.
 */
export function buildSearchLimitGate(trialAvailable: boolean): GatePayload {
  return buildGatePayload(
    "search_limit",
    "Search limit reached",
    `You've used ${FREE_TIER_SEARCH_CAP} of ${FREE_TIER_SEARCH_CAP} free searches today.`,
    trialAvailable,
  );
}

/**
 * Extract a teaser first-line from a story's `why_it_matters`. The
 * 12g spec specifies "first line of generic commentary"; chunk 5
 * adds a dedicated `generic_commentary` column. Until that lands,
 * `why_it_matters` is the role-neutral text we already have on every
 * row — same audience framing, so the swap will be a one-field
 * change.
 */
export function teaserFirstLine(whyItMatters: string): string {
  const trimmed = whyItMatters.trim();
  const breakIdx = trimmed.search(/[.!?\n]/);
  const slice = breakIdx > 0 ? trimmed.slice(0, breakIdx + 1) : trimmed;
  return slice.slice(0, 200).trim();
}
