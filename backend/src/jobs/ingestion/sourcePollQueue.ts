// `signal-ingestion-poll` — BullMQ queue for per-source poll jobs.
// Pattern matches `aggregationQueue.ts`: lazy queue construction,
// graceful no-op when REDIS_URL is unset.
//
// 12e.1 ships the queue. 12e.5c sub-step 5 adds
// `scheduleSourcePollRepeatable()` — reads `ingestion_sources.fetch_interval_seconds`
// per row and creates one BullMQ repeatable job per enabled source with
// the source-specific cadence. Disabled sources or sources with
// non-positive intervals are skipped.
//
// 12e.5d will extend this for adapter-specific schedule semantics
// (SEC EDGAR business-hours-aware, arXiv daily-at-fixed-time, etc.).
// 12e.5c keeps the simple `every: ms` form.

import { Queue, type JobsOptions } from "bullmq";
import { db as defaultDb } from "../../db";
import { ingestionSources } from "../../db/schema";
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

export interface ScheduleSourcePollDeps {
  db?: typeof defaultDb;
  queue?: Queue<SourcePollJobInput> | null;
}

export interface ScheduleSourcePollResult {
  scheduled: number;
  skipped: number;
}

/**
 * Schedule one BullMQ repeatable job per enabled source, cadence driven
 * by `ingestion_sources.fetch_interval_seconds`. Safe to call multiple
 * times — BullMQ dedupes repeatable jobs by jobId. Returns
 * `{ scheduled: 0, skipped: 0 }` when Redis is unavailable so server
 * boot can log and continue.
 *
 * Per-source jobId is `repeat:poll:<slug>` — slug is unique per source
 * (per the schema's UNIQUE constraint), so the dedup is well-defined.
 *
 * Cadence-change limitation: BullMQ's repeatable-job dedup is keyed on
 * the (name + repeat-spec) pair, so changing `fetch_interval_seconds`
 * between deploys creates a new repeatable schedule alongside the old
 * one. 12e.5d will add a cleanup pass that removes stale schedules via
 * `queue.removeRepeatableByKey`. For 12e.5c, cadences are expected to
 * be stable across deploys and the leftover-schedule risk is accepted.
 */
export async function scheduleSourcePollRepeatable(
  deps: ScheduleSourcePollDeps = {},
): Promise<ScheduleSourcePollResult> {
  const dbInstance = deps.db ?? defaultDb;
  const queue = deps.queue ?? getSourcePollQueue();
  if (!queue) {
    // eslint-disable-next-line no-console
    console.warn(
      "[signal-backend] source-poll scheduler not started (REDIS_URL not set)",
    );
    return { scheduled: 0, skipped: 0 };
  }

  const sources = await dbInstance
    .select({
      id: ingestionSources.id,
      slug: ingestionSources.slug,
      enabled: ingestionSources.enabled,
      fetchIntervalSeconds: ingestionSources.fetchIntervalSeconds,
    })
    .from(ingestionSources);

  let scheduled = 0;
  let skipped = 0;

  for (const source of sources) {
    if (!source.enabled) {
      skipped += 1;
      continue;
    }
    // Defensive: schema declares fetch_interval_seconds NOT NULL with
    // default 1800. A null or non-positive value is treated as
    // "disabled-via-config" rather than scheduled at a degenerate
    // interval.
    if (
      source.fetchIntervalSeconds == null ||
      source.fetchIntervalSeconds <= 0
    ) {
      skipped += 1;
      continue;
    }
    await queue.add(
      SOURCE_POLL_JOB_NAME,
      { sourceId: source.id, triggeredBy: "cron" },
      {
        jobId: `repeat:poll:${source.slug}`,
        repeat: { every: source.fetchIntervalSeconds * 1000 },
        removeOnComplete: { age: 86_400, count: 500 },
        removeOnFail: { age: 604_800 },
      },
    );
    scheduled += 1;
  }

  // eslint-disable-next-line no-console
  console.log(
    `[signal-backend] source-poll scheduler started (sources=${scheduled}, skipped=${skipped})`,
  );
  return { scheduled, skipped };
}

// Test-only reset hook. Intentionally not exported from a barrel.
export function __resetSourcePollQueueForTests(): void {
  cachedQueue = null;
}
