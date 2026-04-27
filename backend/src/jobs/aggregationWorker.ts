import { Worker, type Job } from "bullmq";
import { getRedis, isRedisConfigured } from "../lib/redis";
import {
  AGGREGATION_QUEUE_NAME,
  type AggregationJobData,
} from "./aggregationQueue";
import { processAggregationJob } from "./aggregationJob";

let cachedWorker: Worker<AggregationJobData> | null = null;

async function handle(job: Job<AggregationJobData>): Promise<void> {
  const result = await processAggregationJob({ period: job.data.period });
  // eslint-disable-next-line no-console
  console.log(
    `[signal-backend] [aggregation:done] period=${result.period} processed=${result.processed} triggeredBy=${job.data.triggeredBy ?? "unknown"}`,
  );
}

export function startAggregationWorker(): Worker<AggregationJobData> | null {
  if (cachedWorker) return cachedWorker;
  if (!isRedisConfigured()) {
    // eslint-disable-next-line no-console
    console.warn("[signal-backend] aggregation worker not started (REDIS_URL not set)");
    return null;
  }
  const connection = getRedis();
  if (!connection) return null;

  cachedWorker = new Worker<AggregationJobData>(AGGREGATION_QUEUE_NAME, handle, {
    connection,
    // Aggregation is single-writer per period — concurrency 1 keeps the
    // upsert semantics simple (no contention on the unique constraint).
    concurrency: Number(process.env.AGGREGATION_WORKER_CONCURRENCY ?? 1),
  });
  cachedWorker.on("failed", (job, err) => {
    // eslint-disable-next-line no-console
    console.error(
      `[signal-backend] [aggregation:failed] period=${job?.data.period ?? "current"}: ${err.message}`,
    );
  });
  // eslint-disable-next-line no-console
  console.log("[signal-backend] aggregation worker started");
  return cachedWorker;
}

export async function stopAggregationWorker(): Promise<void> {
  if (cachedWorker) {
    await cachedWorker.close().catch(() => undefined);
    cachedWorker = null;
  }
}
