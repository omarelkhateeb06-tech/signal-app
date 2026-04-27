// `signal-ingestion-enrich` — BullMQ queue separate from
// `signal-ingestion-poll` so adapter throughput doesn't compete with
// LLM throughput. The two queues drain at independent rates: poll
// concurrency tuned for HTTP I/O, enrichment concurrency tuned for
// Haiku rate limits.

import { Queue, type JobsOptions } from "bullmq";
import { getRedis, isRedisConfigured } from "../../lib/redis";
import type { EnrichmentJobInput } from "./enrichmentJob";

export const ENRICHMENT_QUEUE_NAME = "signal-ingestion-enrich";
export const ENRICHMENT_JOB_NAME = "enrich-candidate";

let cachedQueue: Queue<EnrichmentJobInput> | null = null;

function buildQueue(): Queue<EnrichmentJobInput> | null {
  const connection = getRedis();
  if (!connection) return null;
  return new Queue<EnrichmentJobInput>(ENRICHMENT_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "exponential", delay: 60_000 },
      removeOnComplete: { age: 86_400, count: 1000 },
      removeOnFail: { age: 604_800 },
    },
  });
}

export function getEnrichmentQueue(): Queue<EnrichmentJobInput> | null {
  if (cachedQueue) return cachedQueue;
  if (!isRedisConfigured()) return null;
  cachedQueue = buildQueue();
  return cachedQueue;
}

export async function enqueueEnrichment(
  data: EnrichmentJobInput,
  opts?: JobsOptions,
): Promise<{ queued: boolean; jobId?: string }> {
  const queue = getEnrichmentQueue();
  if (!queue) {
    // eslint-disable-next-line no-console
    console.warn(
      "[signal-backend] enrichment queue unavailable (Redis not configured) — skipping enqueue",
    );
    return { queued: false };
  }
  const job = await queue.add(ENRICHMENT_JOB_NAME, data, opts);
  return { queued: true, jobId: job.id };
}

export async function closeEnrichmentQueue(): Promise<void> {
  if (cachedQueue) {
    await cachedQueue.close().catch(() => undefined);
    cachedQueue = null;
  }
}

export function __resetEnrichmentQueueForTests(): void {
  cachedQueue = null;
}
