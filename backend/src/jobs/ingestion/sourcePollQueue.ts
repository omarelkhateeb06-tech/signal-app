// `signal-ingestion-poll` — BullMQ queue for per-source poll jobs.
// Pattern matches `aggregationQueue.ts`: lazy queue construction,
// graceful no-op when REDIS_URL is unset.
//
// 12e.1 ships the queue + a cron-stub scheduler that's a no-op until
// 12e.5c wires it to actual per-source cadences (RSS hourly, EDGAR
// 15-min business hours, arXiv daily 21:00 UTC, etc., per roadmap
// §5.4). Per-source repeatable jobs keyed off
// `ingestion_sources.fetch_interval_seconds` are introduced in 12e.5c.

import { Queue, type JobsOptions } from "bullmq";
import { getRedis, isRedisConfigured } from "../../lib/redis";
import type { SourcePollJobInput } from "./sourcePollJob";

export const SOURCE_POLL_QUEUE_NAME = "signal-ingestion-poll";
export const SOURCE_POLL_JOB_NAME = "poll-source";

let cachedQueue: Queue<SourcePollJobInput> | null = null;

function buildQueue(): Queue<SourcePollJobInput> | null {
  const connection = getRedis();
  if (!connection) return null;
  return new Queue<SourcePollJobInput>(SOURCE_POLL_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: { age: 86_400, count: 500 },
      removeOnFail: { age: 604_800 },
    },
  });
}

export function getSourcePollQueue(): Queue<SourcePollJobInput> | null {
  if (cachedQueue) return cachedQueue;
  if (!isRedisConfigured()) return null;
  cachedQueue = buildQueue();
  return cachedQueue;
}

export async function enqueueSourcePoll(
  data: SourcePollJobInput,
  opts?: JobsOptions,
): Promise<{ queued: boolean; jobId?: string }> {
  const queue = getSourcePollQueue();
  if (!queue) {
    // eslint-disable-next-line no-console
    console.warn(
      "[signal-backend] source-poll queue unavailable (Redis not configured) — skipping enqueue",
    );
    return { queued: false };
  }
  const job = await queue.add(SOURCE_POLL_JOB_NAME, data, opts);
  return { queued: true, jobId: job.id };
}

export async function closeSourcePollQueue(): Promise<void> {
  if (cachedQueue) {
    await cachedQueue.close().catch(() => undefined);
    cachedQueue = null;
  }
}

// Test-only reset hook. Intentionally not exported from a barrel.
export function __resetSourcePollQueueForTests(): void {
  cachedQueue = null;
}
