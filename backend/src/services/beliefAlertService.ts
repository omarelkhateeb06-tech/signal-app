import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { beliefChallenges } from "../db/schema";
import { enqueueEmail } from "../jobs/emailQueue";
import {
  renderBeliefAlertEmail,
  type BeliefAlertRelevance,
} from "../emails/beliefAlertEmail";
import { buildUnsubscribeUrl } from "./unsubscribeService";

// Phase A④ — off-screen delivery of position alerts. The in-app radar shows
// every relevance class; only MATERIAL ones (contradicts/pressures) are worth
// interrupting the reader by email. supports/watch stay on the screen.
function isMaterial(relevance: string): relevance is BeliefAlertRelevance {
  return relevance === "contradicts" || relevance === "pressures";
}

export interface NotifyBeliefAlertInput {
  challengeId: string;
  userId: string;
  toEmail: string;
  toName: string | null;
  positionStatement: string;
  relevance: string;
  howToUpdate: string;
  dissent: string | null;
  sourceHeadline: string | null;
}

// Emails the reader about one material position alert, AT MOST ONCE. The
// notified_at stamp is claimed atomically (guarded UPDATE … WHERE notified_at
// IS NULL RETURNING): if the row comes back we won the claim and send; if not,
// someone already notified (a worker retry, or two enrichment passes racing on
// the same alert) and we silently skip. Never throws — a failed alert email
// must not break the caller (the enrichment worker in ⑤). Returns whether an
// email was enqueued.
export async function notifyBeliefAlert(
  input: NotifyBeliefAlertInput,
): Promise<{ emailed: boolean }> {
  try {
    const { relevance } = input;
    if (!isMaterial(relevance)) return { emailed: false };

    const claimed = await db
      .update(beliefChallenges)
      .set({ notifiedAt: new Date() })
      .where(
        and(
          eq(beliefChallenges.id, input.challengeId),
          isNull(beliefChallenges.notifiedAt),
        ),
      )
      .returning({ id: beliefChallenges.id });
    if (claimed.length === 0) return { emailed: false };

    const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:3000";
    const rendered = renderBeliefAlertEmail({
      toName: input.toName,
      positionStatement: input.positionStatement,
      relevance,
      howToUpdate: input.howToUpdate,
      dissent: input.dissent,
      sourceHeadline: input.sourceHeadline,
      frontendUrl,
      unsubscribeUrl: buildUnsubscribeUrl(input.userId, frontendUrl),
    });
    await enqueueEmail({
      type: "belief-alert",
      payload: {
        to: input.toEmail,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        categories: ["belief-alert"],
      },
    });
    return { emailed: true };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[signal-backend] belief alert email failed:", err);
    return { emailed: false };
  }
}
