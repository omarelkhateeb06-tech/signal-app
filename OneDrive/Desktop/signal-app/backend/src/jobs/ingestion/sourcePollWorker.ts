// `signal-ingestion-poll` worker. Receives poll jobs and dispatches
// into `processSourcePollJob`. 12e.1 ships a thin shell that logs
// receipt and a degenerate (no-op) result; 12e.2 fills in the adapter
// dispatch path.

import { Worker, type Job } from "bullmq";
import { getRedis, isRedisConfigured } from "../../lib/redis";
import { SOURCE_POLL_QUEUE_NAME } from "./sourcePollQueue";
import { processSourcePollJob, type SourcePollJobInput } from "./sourcePollJob";

let cachedWorker: Worker<SourcePollJobInput> | null = null;

async function handle(job: Job<SourcePollJobInput>): Promise<void> {
  const result = await processSourcePollJob(job.data);
  // eslint-disable-next-line no-console
  console.log(
    `[signal-backend] [ingestion-poll:done] source=${result.sourceId} discovered=${result.candidatesDiscovered} persisted=${result.candidatesPersisted} failure=${result.failureReason ?? "none"}`,
  );
}

export function startSourcePollWorker(): Worker<SourcePollJobInput> | null {
  if (cachedWorker) return cachedWorker;
  if (!isRedisConfigured()) {
    // eslint-disable-next-line no-console
    console.warn(
      "[signal-backend] source-poll worker not started (REDIS_URL not set)",
    );
    return null;
  }
  const connection = getRedis();
  if (!connection) return null;

  cachedWorker = new Worker<SourcePollJobInput>(SOURCE_POLL_QUEUE_NAME, handle, {
    connection,
    concurrency: Number(process.env.INGESTION_POLL_CONCURRENCY ?? 4),
  });
  cachedWorker.on("failed", (job, err) => {
    // eslint-disable-next-line no-console
    console.error(
      `[signal-backend] [ingestion-poll:failed] source=${job?.data.sourceId ?? "unknown"}: ${err.message}`,
    );
  });
  // eslint-disable-next-line no-console
  console.log("[signal-backend] source-poll worker started");
  return cachedWorker;
}

export async function stopSourcePollWorker(): Promise<void> {
  if (cachedWorker) {
    await cachedWorker.close().catch(() => undefined);
    cachedWorker = null;
  }
}
