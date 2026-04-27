import type { NextFunction, Request, Response } from "express";
import * as Sentry from "@sentry/node";
import { getRedis } from "../lib/redis";

// Per-API-key rate limiter. Fixed 1-minute window, Redis-backed counter,
// fails open on Redis errors.
//
// Must run AFTER apiKeyAuth so req.apiKey is populated. 11c will mount
// this on v2 routes as: router.use(apiKeyAuth, apiKeyRateLimit, ...).
// It is intentionally NOT mounted in app.ts yet.
//
// Default env var: API_KEY_RATE_LIMIT_PER_MINUTE (default 300).
// Rationale for 300 vs. a tighter 100: a fresh integration doing paginated
// catchup (e.g. 500 stories @ 100 per page) should not stall for minutes
// on its first call. 300/min (5/sec) still catches runaway loops.

const DEFAULT_LIMIT_PER_MINUTE = 300;
const WINDOW_SECONDS = 60;

function getLimit(): number {
  const raw = process.env.API_KEY_RATE_LIMIT_PER_MINUTE?.trim();
  if (raw && raw.length > 0) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_LIMIT_PER_MINUTE;
}

function setRateLimitHeaders(
  res: Response,
  limit: number,
  remaining: number,
  resetUnixSeconds: number,
): void {
  res.setHeader("X-RateLimit-Limit", String(limit));
  res.setHeader("X-RateLimit-Remaining", String(Math.max(0, remaining)));
  res.setHeader("X-RateLimit-Reset", String(resetUnixSeconds));
}

export async function apiKeyRateLimit(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const limit = getLimit();

  // Defensive: if upstream routing forgot to mount apiKeyAuth first,
  // fall through rather than 500. A silently-unlimited request is still
  // preferable to a 500 on an otherwise-authenticated call. The warning
  // surfaces the misconfiguration for ops.
  const apiKeyId = req.apiKey?.id;
  if (!apiKeyId) {
    // eslint-disable-next-line no-console
    console.warn(
      "[apiKeyRateLimit] req.apiKey missing — passing through without rate limiting. Check middleware order.",
    );
    next();
    return;
  }

  const now = Date.now();
  const minuteWindow = Math.floor(now / (WINDOW_SECONDS * 1000));
  const windowEndMs = (minuteWindow + 1) * WINDOW_SECONDS * 1000;
  const resetUnixSeconds = Math.ceil(windowEndMs / 1000);
  const retryAfterSeconds = Math.max(1, Math.ceil((windowEndMs - now) / 1000));
  const redisKey = `ratelimit:apikey:${apiKeyId}:${minuteWindow}`;

  const redis = getRedis();
  if (!redis) {
    // No Redis configured (local dev, or intentional degraded config).
    // Fail open without Sentry noise — this is deliberate, not an incident.
    setRateLimitHeaders(res, limit, limit, resetUnixSeconds);
    next();
    return;
  }

  let count: number;
  try {
    count = await redis.incr(redisKey);
    if (count === 1) {
      // First hit of a new window. Use unconditional EXPIRE (not NX) so we
      // stay portable to Redis < 7.0 — re-setting an expiry to the same
      // value on a brand-new key is free, and the "on first hit only"
      // guard already prevents resetting on subsequent hits in the window.
      await redis.expire(redisKey, WINDOW_SECONDS);
    }
  } catch (err) {
    // Rate limiting is throttling, not security. A Redis blip should not
    // take down the API. Log structured, surface a Sentry *warning* (not
    // error — error-level would eventually page on-call for a non-critical
    // degradation), and allow the request through.
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.warn(
      `[apiKeyRateLimit] ratelimit_redis_unavailable apiKeyId=${apiKeyId} err=${message}`,
    );
    Sentry.captureMessage("Rate limiter fail-open: Redis unavailable", {
      level: "warning",
      extra: { apiKeyId, err: message },
    });
    setRateLimitHeaders(res, limit, limit, resetUnixSeconds);
    next();
    return;
  }

  const remaining = limit - count;
  setRateLimitHeaders(res, limit, remaining, resetUnixSeconds);

  if (count > limit) {
    res.setHeader("Retry-After", String(retryAfterSeconds));
    res.status(429).json({
      error: {
        code: "RATE_LIMIT_EXCEEDED",
        message: `Rate limit of ${limit} requests per minute exceeded. Retry in ${retryAfterSeconds}s.`,
      },
    });
    return;
  }

  next();
}
