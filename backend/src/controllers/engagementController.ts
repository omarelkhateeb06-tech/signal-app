import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { db } from "../db";
import { engagementEvents } from "../db/schema";
import { AppError } from "../middleware/errorHandler";

// Max events per batched POST. Sized to hold a scroll session's worth of
// dwell/click telemetry without admitting pathological payloads. Mirrors the
// onboarding-events batch cap.
const EVENTS_BATCH_MAX = 50;

const eventSchema = z.object({
  // e.g. "story_view", "click_through", "share". Free-form (capped) so new
  // signal types don't need a schema change.
  event_type: z.string().min(1).max(64),
  // The story/event this interaction targets. Optional — some events are
  // feed-level, not story-level. Validated as a uuid when present.
  event_id: z.string().uuid().nullable().optional(),
  // Dwell time in ms for view events. Capped at 24h to reject garbage.
  dwell_ms: z.number().int().min(0).max(86_400_000).nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
  // Client-supplied interaction time; late-flushed beacons reflect the real
  // time rather than network arrival. Falls back to the DB now() default.
  occurred_at: z.string().datetime({ offset: true }).optional(),
});

const eventsBatchSchema = z.object({
  events: z.array(eventSchema).min(1).max(EVENTS_BATCH_MAX),
});

function requireUserId(req: Request): string {
  if (!req.user) {
    throw new AppError("UNAUTHORIZED", "Not authenticated", 401);
  }
  return req.user.userId;
}

/**
 * POST /api/v1/engagement/events
 *
 * Batched, append-only engagement telemetry (scroll-dwell, click-through,
 * share). Mirrors /onboarding/events: validate + fan-out INSERT, no reads,
 * no business logic. Returns 202. Aggregated into Ranking v2 (12o.5) once
 * behavioural data accrues.
 */
export async function postEngagementEvents(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const input = eventsBatchSchema.parse(req.body);

    const rows = input.events.map((e) => ({
      userId,
      eventType: e.event_type,
      eventId: e.event_id ?? null,
      dwellMs: e.dwell_ms ?? null,
      metadata: e.metadata ?? {},
      ...(e.occurred_at !== undefined ? { createdAt: new Date(e.occurred_at) } : {}),
    }));

    await db.insert(engagementEvents).values(rows);

    res.status(202).json({ data: { accepted: rows.length } });
  } catch (error) {
    next(error);
  }
}
