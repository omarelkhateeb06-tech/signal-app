import { Worker, type Job } from "bullmq";
import { getRedis, isRedisConfigured } from "../lib/redis";
import { sendEmail } from "../services/emailService";
import { EMAIL_QUEUE_NAME, type EmailJobData } from "./emailQueue";

let cachedWorker: Worker<EmailJobData> | null = null;

async function processJob(job: Job<EmailJobData>): Promise<void> {
  const { payload, type } = job.data;
  const result = await sendEmail(payload);
  // eslint-disable-next-line no-console
  console.log(
    `[signal-backend] [email:sent] type=${type} to=${payload.to} provider=${result.provider} delivered=${result.delivered}`,
  );
}

export function startEmailWorker(): Worker<EmailJobData> | null {
  if (cachedWorker) return cachedWorker;
  if (!isRedisConfigured()) {
    // eslint-disable-next-line no-console
    console.warn("[signal-backend] email worker not started (REDIS_URL not set)");
    return null;
  }
  const connection = getRedis();
  if (!connection) return null;

  cachedWorker = new Worker<EmailJobData>(EMAIL_QUEUE_NAME, processJob, {
    connection,
    concurrency: Number(process.env.EMAIL_WORKER_CONCURRENCY ?? 5),
  });
  cachedWorker.on("failed", (job, err) => {
    // eslint-disable-next-line no-console
    console.error(
      `[signal-backend] [email:failed] type=${job?.data.type} to=${job?.data.payload.to}: ${err.message}`,
    );
  });
  // eslint-disable-next-line no-console
  console.log("[signal-backend] email worker started");
  return cachedWorker;
}

export async function stopEmailWorker(): Promise<void> {
  if (cachedWorker) {
    await cachedWorker.close().catch(() => undefined);
    cachedWorker = null;
  }
}
