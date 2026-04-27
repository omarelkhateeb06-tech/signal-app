import { Queue, type JobsOptions } from "bullmq";
import { getRedis, isRedisConfigured } from "../lib/redis";
import { sendEmail, type EmailPayload } from "../services/emailService";

export const EMAIL_QUEUE_NAME = "signal-emails";

export type EmailJobType = "welcome" | "weekly-digest" | "password-reset" | "team-invite";

export interface EmailJobData {
  type: EmailJobType;
  payload: EmailPayload;
}

let cachedQueue: Queue<EmailJobData> | null = null;

function buildQueue(): Queue<EmailJobData> | null {
  const connection = getRedis();
  if (!connection) return null;
  return new Queue<EmailJobData>(EMAIL_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: { age: 86_400, count: 1000 },
      removeOnFail: { age: 604_800 },
    },
  });
}

export function getEmailQueue(): Queue<EmailJobData> | null {
  if (cachedQueue) return cachedQueue;
  if (!isRedisConfigured()) return null;
  cachedQueue = buildQueue();
  return cachedQueue;
}

export async function enqueueEmail(
  data: EmailJobData,
  opts?: JobsOptions,
): Promise<{ queued: boolean; jobId?: string }> {
  const queue = getEmailQueue();
  if (!queue) {
    // Graceful degradation: send synchronously (which will also no-op if SendGrid missing).
    // eslint-disable-next-line no-console
    console.warn(
      `[signal-backend] email queue unavailable — sending ${data.type} synchronously`,
    );
    await sendEmail(data.payload);
    return { queued: false };
  }
  const job = await queue.add(data.type, data, opts);
  return { queued: true, jobId: job.id };
}

export async function closeEmailQueue(): Promise<void> {
  if (cachedQueue) {
    await cachedQueue.close().catch(() => undefined);
    cachedQueue = null;
  }
}
