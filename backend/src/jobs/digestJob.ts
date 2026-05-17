// Phase 12i — daily digest dispatch. Replaces the Phase 7 weekly
// digest job. Tier-gated: Pro and active-trial pro_trial users only.
//
// Eligibility query (single SQL pass):
//
//   active user (users.status = 'active')
//   AND (
//     users.tier = 'pro'
//     OR (
//       users.tier = 'pro_trial'
//       AND users.trial_started_at > now() - 7d
//     )
//   )
//   AND user_profiles.email_unsubscribed = false
//   AND user_profiles.email_frequency = 'daily'
//
// The trial-expiry clause replicates the read-only check from
// resolveEffectiveTier rather than calling the middleware per-user.
// The middleware does a side-effecting UPDATE on downgrade — that
// write does not belong in a batch read job. The lazy-downgrade
// happens on the user's next interactive request; the digest path
// stays read-only and idempotent.

import { and, eq, gt, or, sql } from "drizzle-orm";
import { db } from "../db";
import { TRIAL_DURATION_MS, userProfiles, users } from "../db/schema";
import {
  compileDailyDigest,
  currentDailyWindow,
  type DailyDigestWindow,
} from "../services/digestService";
import { renderDailyDigestEmail } from "../emails/dailyDigestEmail";
import { buildUnsubscribeUrl } from "../services/unsubscribeService";
import { enqueueEmail } from "./emailQueue";

export interface DigestRecipient {
  userId: string;
  email: string;
  name: string | null;
  sectors: string[] | null;
}

export async function listDailyDigestRecipients(
  now: Date = new Date(),
): Promise<DigestRecipient[]> {
  const trialCutoff = new Date(now.getTime() - TRIAL_DURATION_MS);

  const rows = await db
    .select({
      userId: users.id,
      email: users.email,
      name: users.name,
      sectors: userProfiles.sectors,
    })
    .from(users)
    .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
    .where(
      and(
        eq(users.status, "active"),
        or(
          eq(users.tier, "pro"),
          and(
            eq(users.tier, "pro_trial"),
            gt(users.trialStartedAt, trialCutoff),
          ),
        ),
        eq(userProfiles.emailUnsubscribed, false),
        eq(userProfiles.emailFrequency, "daily"),
      ),
    );

  return rows.map((r) => ({
    userId: r.userId,
    email: r.email,
    name: r.name,
    sectors: r.sectors ?? null,
  }));
}

export interface SendDailyDigestsResult {
  enqueued: number;
  skipped: number;
  failed: number;
  window: DailyDigestWindow;
}

export interface SendDailyDigestsOptions {
  frontendUrl?: string;
  window?: DailyDigestWindow;
  targetUserId?: string;
  now?: Date;
}

export async function sendDailyDigests(
  opts: SendDailyDigestsOptions = {},
): Promise<SendDailyDigestsResult> {
  const frontendUrl =
    opts.frontendUrl ?? process.env.FRONTEND_URL ?? "http://localhost:3000";
  const now = opts.now ?? new Date();
  const window = opts.window ?? currentDailyWindow(now);

  let recipients = await listDailyDigestRecipients(now);
  if (opts.targetUserId) {
    recipients = recipients.filter((r) => r.userId === opts.targetUserId);
  }

  let enqueued = 0;
  let skipped = 0;
  let failed = 0;

  // Sequential per the spec: at current scale (zero real users) the
  // per-user work is a single SELECT + an enqueue, both sub-ms; a
  // concurrency cap is the right pattern when this scales but does
  // not pay for itself yet. Set sequentially here; ergonomic upgrade
  // to a Promise.all-with-cap is one search-and-replace away.
  for (const recipient of recipients) {
    try {
      const digest = await compileDailyDigest({
        sectors: recipient.sectors,
        window,
      });
      if (digest.stories.length === 0) {
        skipped += 1;
        continue;
      }
      const unsubscribeUrl = buildUnsubscribeUrl(recipient.userId, frontendUrl);
      const rendered = renderDailyDigestEmail({
        email: recipient.email,
        storiesBySector: digest.bySector,
        dayLabel: window.label,
        frontendUrl,
        unsubscribeUrl,
      });
      await enqueueEmail({
        type: "daily-digest",
        payload: {
          to: recipient.email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          categories: ["digest", "daily"],
        },
      });
      enqueued += 1;
    } catch (err) {
      // Per-user failures must not abort the batch. Log structured;
      // the per-user enqueue itself is idempotent at the BullMQ layer
      // (the worker handles transient send failures separately).
      failed += 1;
      // eslint-disable-next-line no-console
      console.error(
        `[daily-digest] enqueue failed user=${recipient.userId}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return { enqueued, skipped, failed, window };
}

// Touch sql to keep the import alive in lint configurations that
// strip unused symbols — composite filters above use sql via drizzle
// helpers, but lint can't see through and().
void sql;
