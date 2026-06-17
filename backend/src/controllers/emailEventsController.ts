import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { db } from "../db";
import { emailEvents } from "../db/schema";
import { AppError } from "../middleware/errorHandler";

// Phase 12w — SendGrid Event Webhook sink.
//
// POST /api/v1/emails/webhook — SendGrid batches delivered/open/click/bounce/
// dropped/spamreport/unsubscribe events and POSTs them here as a JSON array.
// We validate leniently (store the raw event for drill-down), map the fields
// we report on, and bulk-insert with ON CONFLICT DO NOTHING keyed on
// sg_event_id so webhook retries are idempotent. Append-only; never read on
// the request path.
//
// Auth: SendGrid can't send a Bearer header, but it can carry a query string
// on the webhook URL. If SENDGRID_WEBHOOK_TOKEN is set we require
// ?token=<it>; if unset we accept (dev / pre-config), mirroring the billing
// webhook's "no secret → accept" posture. Setting the token in prod is
// strongly recommended (see DEPLOYMENT notes).

// SendGrid's `category` is a string or an array of strings (or absent).
const categoryField = z.union([z.string(), z.array(z.string())]).optional();

const sgEventSchema = z
  .object({
    email: z.string().optional(),
    event: z.string().optional(),
    sg_event_id: z.string().optional(),
    sg_message_id: z.string().optional(),
    timestamp: z.number().optional(),
    url: z.string().optional(),
    category: categoryField,
  })
  // Keep unknown SendGrid fields so the full event is preserved in `raw`.
  .passthrough();

// SendGrid posts a top-level JSON array. Cap the batch to reject pathological
// payloads (SendGrid's default max batch is ~1000 events/POST).
const sgBatchSchema = z.array(sgEventSchema).max(2000);

function normalizeCategories(category: string | string[] | undefined): string[] {
  if (category === undefined) return [];
  return Array.isArray(category) ? category : [category];
}

function verifyWebhookToken(req: Request): void {
  const expected = process.env.SENDGRID_WEBHOOK_TOKEN?.trim();
  if (!expected) return; // unconfigured → accept (fail-open, like billing)
  const provided = typeof req.query.token === "string" ? req.query.token : "";
  if (provided !== expected) {
    throw new AppError("UNAUTHORIZED", "Invalid webhook token", 401);
  }
}

export async function postSendgridEventWebhook(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    verifyWebhookToken(req);
    const events = sgBatchSchema.parse(req.body);

    if (events.length === 0) {
      res.status(200).json({ data: { accepted: 0 } });
      return;
    }

    const rows = events.map((e) => ({
      sgEventId: e.sg_event_id ?? null,
      sgMessageId: e.sg_message_id ?? null,
      email: e.email ?? "",
      eventType: e.event ?? "unknown",
      url: e.url ?? null,
      categories: normalizeCategories(e.category),
      occurredAt: e.timestamp ? new Date(e.timestamp * 1000) : null,
      raw: e as Record<string, unknown>,
    }));

    // ON CONFLICT DO NOTHING on the partial unique index over sg_event_id —
    // SendGrid re-POSTs on a non-2xx, so retries must not double-count.
    await db.insert(emailEvents).values(rows).onConflictDoNothing();

    res.status(200).json({ data: { accepted: rows.length } });
  } catch (error) {
    next(error);
  }
}
