import { and, eq, ne } from "drizzle-orm";
import { db } from "../db";
import { userProfiles, users } from "../db/schema";
import { compileDigest, currentDigestWindow, type DigestWindow } from "../services/digestService";
import { renderWeeklyDigestEmail } from "../emails/weeklyDigestEmail";
import { buildUnsubscribeUrl } from "../services/unsubscribeService";
import { enqueueEmail } from "./emailQueue";

export interface DigestUserRow {
  userId: string;
  email: string;
  name: string | null;
  sectors: string[] | null;
  frequency: "daily" | "weekly" | "never";
}

export async function listDigestRecipients(): Promise<DigestUserRow[]> {
  const rows = await db
    .select({
      userId: users.id,
      email: users.email,
      name: users.name,
      sectors: userProfiles.sectors,
      frequency: userProfiles.emailFrequency,
      unsubscribed: userProfiles.emailUnsubscribed,
      status: users.status,
    })
    .from(users)
    .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
    .where(
      and(
        eq(users.status, "active"),
        eq(userProfiles.emailUnsubscribed, false),
        ne(userProfiles.emailFrequency, "never"),
      ),
    );

  return rows.map((r) => ({
    userId: r.userId,
    email: r.email,
    name: r.name,
    sectors: r.sectors ?? null,
    frequency: (r.frequency ?? "weekly") as "daily" | "weekly" | "never",
  }));
}

export interface SendDigestsResult {
  enqueued: number;
  skipped: number;
  window: DigestWindow;
}

export async function sendWeeklyDigests(opts: {
  frontendUrl?: string;
  window?: DigestWindow;
  targetUserId?: string;
} = {}): Promise<SendDigestsResult> {
  const frontendUrl = opts.frontendUrl ?? process.env.FRONTEND_URL ?? "http://localhost:3000";
  const window = opts.window ?? currentDigestWindow();

  let recipients = await listDigestRecipients();
  if (opts.targetUserId) {
    recipients = recipients.filter((r) => r.userId === opts.targetUserId);
  }

  let enqueued = 0;
  let skipped = 0;

  for (const recipient of recipients) {
    const { stories } = await compileDigest({
      sectors: recipient.sectors,
      window,
    });
    if (stories.length === 0) {
      skipped += 1;
      continue;
    }
    const unsubscribeUrl = buildUnsubscribeUrl(recipient.userId, frontendUrl);
    const rendered = renderWeeklyDigestEmail({
      name: recipient.name,
      email: recipient.email,
      stories,
      weekLabel: window.label,
      frontendUrl,
      unsubscribeUrl,
    });
    await enqueueEmail({
      type: "weekly-digest",
      payload: {
        to: recipient.email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        categories: ["digest", "weekly"],
      },
    });
    enqueued += 1;
  }

  return { enqueued, skipped, window };
}
