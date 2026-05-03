// Phase 12e.6c — re-enrichment rate limiter. One re-enrich per event per
// 1 hour, enforced via Redis SET NX with a 3600s TTL. The check-and-set
// is atomic — no separate GET/SET race window.
//
// Fail-open semantics on the cost side: if Redis is unreachable (null
// client, network error), return allowed=false so we SKIP re-enrichment.
// This keeps Haiku cost capped during Redis outages instead of letting
// every attach trigger an unbounded re-enrich. Logged at warn level —
// not Sentry, since infrastructure availability is monitored elsewhere.

import type { Redis } from "ioredis";

const KEY_PREFIX = "reenrich:rate:";
const TTL_SECONDS = 3600;

export interface RateLimitResult {
  allowed: boolean;
}

export async function checkAndSetReenrichRateLimit(
  eventId: string,
  deps: { redis: Redis | null },
): Promise<RateLimitResult> {
  if (!deps.redis) {
    // eslint-disable-next-line no-console
    console.warn(
      `[ingestion-reenrich] redis unavailable, skipping re-enrich for event=${eventId}`,
    );
    return { allowed: false };
  }

  const key = `${KEY_PREFIX}${eventId}`;
  try {
    const result = await deps.redis.set(key, "1", "EX", TTL_SECONDS, "NX");
    return { allowed: result === "OK" };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.warn(
      `[ingestion-reenrich] redis error on rate-limit check for event=${eventId}: ${detail}`,
    );
    return { allowed: false };
  }
}
