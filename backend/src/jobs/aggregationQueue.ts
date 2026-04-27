import { Queue, type JobsOptions } from "bullmq";
import { getRedis, isRedisConfigured } from "../lib/redis";

export const AGGREGATION_QUEUE_NAME = "signal-aggregation";
export const AGGREGATION_JOB_NAME = "compute-sector-weekly";

// 02:00 UTC daily. Running at 02:00 rather than 00:00 gives late-arriving
// Sunday-night story inserts (across timezones) time to settle before the
// week's rollup is taken. Repeated runs in the same period are safe — the
// job upserts on (sector, period).
export const AGGREGATION_CRON_PATTERN = process.env.AGGREGATION_CRON ?? "0 2 * * *";

export interface AggregationJobData {
  // Optional ISO week ("2026-W16") to target a specific period. Omitted
  // for scheduled runs — the job defaults to the current week.
  period?: string;
  triggeredBy?: "cron" | "cli" | "test";
}

let cachedQueue: Queue<AggregationJobData> | null = null;

function buildQueue(): Queue<AggregationJobData> | null {
  const connection = getRedis();
  if (!connection) return null;
  return new Queue<AggregationJobData>(AGGREGATION_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: { age: 86_400, count: 100 },
      removeOnFail: { age: 604_800 },
    },
  });
}

export function getAggregationQueue(): Queue<AggregationJobData> | null {
  if (cachedQueue) return cachedQueue;
  if (!isRedisConfigured()) return null;
  cachedQueue = buildQueue();
  return cachedQueue;
}

export async function enqueueAggregation(
  data: AggregationJobData = {},
  opts?: JobsOptions,
): Promise<{ queued: boolean; jobId?: string }> {
  const queue = getAggregationQueue();
  if (!queue) {
    // eslint-disable-next-line no-console
    console.warn(
      "[signal-backend] aggregation queue unavailable (Redis not configured) — skipping enqueue",
    );
    return { queued: false };
  }
  const job = await queue.add(AGGREGATION_JOB_NAME, data, opts);
  return { queued: true, jobId: job.id };
}

/**
 * Registers a BullMQ repeatable job for the daily aggregation cron. Safe
 * to call multiple times — BullMQ dedupes repeatable jobs by jobId. Returns
 * `false` when Redis is unavailable so server boot can log and continue.
 */
export async function scheduleAggregationRepeatable(): Promise<boolean> {
  const queue = getAggregationQueue();
  if (!queue) {
    // eslint-disable-next-line no-console
    console.warn(
      "[signal-backend] aggregation scheduler not started (REDIS_URL not set)",
    );
    return false;
  }
  await queue.add(
    AGGREGATION_JOB_NAME,
    { triggeredBy: "cron" },
    {
      jobId: `repeat:${AGGREGATION_JOB_NAME}`,
      repeat: { pattern: AGGREGATION_CRON_PATTERN, tz: "UTC" },
      removeOnComplete: { age: 86_400, count: 100 },
      removeOnFail: { age: 604_800 },
    },
  );
  // eslint-disable-next-line no-console
  console.log(
    `[signal-backend] aggregation scheduler started (cron="${AGGREGATION_CRON_PATTERN}" tz=UTC)`,
  );
  return true;
}

export async function closeAggregationQueue(): Promise<void> {
  if (cachedQueue) {
    await cachedQueue.close().catch(() => undefined);
    cachedQueue = null;
  }
}

// Test-only reset hook. Intentionally not exported from the jobs barrel.
export function __resetAggregationQueueForTests(): void {
  cachedQueue = null;
}
