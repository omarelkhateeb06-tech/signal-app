import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { db } from "../db";
import { productEvents } from "../db/schema";

// Phase 12w — product / funnel analytics sink.
//
// POST /api/v1/events — single-event write from lib/analytics.ts's track()
// beacon. Optional-auth (see optionalAuth middleware): authed callers get the
// event attributed to their user_id; anonymous beacons land user-less so the
// pre-signup funnel (landing, signup_started) is still counted. Append-only,
// no reads, no business logic. Returns 202.
//
// Single-event (not batched like engagement/onboarding) by design: funnel
// events are low-frequency relative to scroll-dwell telemetry, so the client
// fires one beacon per event rather than buffering.

const productEventSchema = z.object({
  // e.g. "upgrade_viewed", "checkout_started", "signup_completed". Free-form
  // (capped) so new funnel events don't need a schema change.
  event: z.string().min(1).max(64),
  props: z.record(z.unknown()).optional(),
  // window.location.pathname at fire time. Capped to reject pathological input.
  path: z.string().max(512).optional(),
  // Client-supplied fire time (ms epoch); informational. created_at is stamped
  // server-side, but the client ts is retained in props for ordering analysis.
  ts: z.number().int().nonnegative().optional(),
});

export async function postProductEvent(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = productEventSchema.parse(req.body);

    const props: Record<string, unknown> = { ...(input.props ?? {}) };
    if (input.ts !== undefined) props.client_ts = input.ts;

    await db.insert(productEvents).values({
      userId: req.user?.userId ?? null,
      eventType: input.event,
      path: input.path ?? null,
      props,
    });

    res.status(202).json({ data: { accepted: 1 } });
  } catch (error) {
    next(error);
  }
}
