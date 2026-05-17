import type { NextFunction, Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { TRIAL_DURATION_MS, type UserTier, users } from "../db/schema";

// Phase 12g — paywall tier resolution.
//
// `resolveEffectiveTier()` reads the stored tier, applies the 7-day
// pro_trial expiry rule, and lazy-writes the downgrade if needed. No
// cron — the first request after expiry pays the UPDATE cost. The
// downgrade UPDATE is guarded by `tier = 'pro_trial'` so concurrent
// requests from the same user can race safely; whichever lands first
// flips the row and the loser is a no-op rowcount.
//
// `attachTier` is the Express middleware wrapper. It populates
// `req.tier` with the effective tier and does NOT block — gating
// decisions belong in downstream controllers, which read `req.tier`
// alongside the rest of the request shape. An absent / unknown user
// resolves to `"free"`, matching the 12g spec: "Unauthenticated → same
// as `free`." This means `attachTier` is safe to mount on either
// auth-required or public routes.

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      tier?: UserTier;
    }
  }
}

export interface EffectiveTierResult {
  tier: UserTier;
  // null for `free` and `pro`; integer days for `pro_trial`. Computed
  // with `Math.ceil` so a fresh trial reads as 7 and the last 24h reads
  // as 1 (the threshold the header badge flips to urgent).
  trialDaysRemaining: number | null;
  // The original trial anchor, or null for users who never started a
  // trial. Drives `upgrade_cta.trial_available` in the gate response.
  trialStartedAt: Date | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function resolveEffectiveTier(
  userId: string | undefined,
): Promise<EffectiveTierResult> {
  if (!userId) {
    return { tier: "free", trialDaysRemaining: null, trialStartedAt: null };
  }

  const [row] = await db
    .select({
      tier: users.tier,
      trialStartedAt: users.trialStartedAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) {
    // requireAuth said you exist, the DB says you don't — auth is the
    // source of truth on identity, so don't 401 here; gating defaults
    // to least-permissive and the caller's downstream controller can
    // decide whether to surface a 404 / 401 of its own.
    return { tier: "free", trialDaysRemaining: null, trialStartedAt: null };
  }

  if (row.tier === "pro" || row.tier === "free") {
    return {
      tier: row.tier,
      trialDaysRemaining: null,
      trialStartedAt: row.trialStartedAt,
    };
  }

  // tier = "pro_trial" below this point.
  if (!row.trialStartedAt) {
    // Anomaly: a `pro_trial` row with no anchor. Either someone
    // INSERTed bypassing the signup path, or the backfill in migration
    // 0029 missed the row. Anchor now so the trial actually starts
    // ticking down instead of remaining a permanent pro_trial.
    const anchor = new Date();
    await db
      .update(users)
      .set({ trialStartedAt: anchor })
      .where(eq(users.id, userId));
    return { tier: "pro_trial", trialDaysRemaining: 7, trialStartedAt: anchor };
  }

  const now = Date.now();
  const expiresAt = row.trialStartedAt.getTime() + TRIAL_DURATION_MS;

  if (now < expiresAt) {
    return {
      tier: "pro_trial",
      trialDaysRemaining: Math.ceil((expiresAt - now) / DAY_MS),
      trialStartedAt: row.trialStartedAt,
    };
  }

  // Trial expired — lazy downgrade. The `tier = 'pro_trial'` guard
  // makes this a no-op if a concurrent request already wrote the
  // downgrade. `trial_started_at` stays put for audit; `tier_changed_at`
  // records the flip.
  await db
    .update(users)
    .set({ tier: "free", tierChangedAt: new Date() })
    .where(and(eq(users.id, userId), eq(users.tier, "pro_trial")));

  return {
    tier: "free",
    trialDaysRemaining: 0,
    trialStartedAt: row.trialStartedAt,
  };
}

export async function attachTier(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await resolveEffectiveTier(req.user?.userId);
    req.tier = result.tier;
    next();
  } catch (err) {
    next(err);
  }
}
