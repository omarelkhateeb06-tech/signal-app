// Phase 12e.5c sub-step 8 — cadence verification helper (runs after
// the main harness completes). Calls scheduleSourcePollRepeatable
// against the ephemeral Redis and snapshots the resulting repeatable
// jobs so the smoke writeup has the real BullMQ-side schedule list,
// not just the expected-shape derived from source rows.

import "dotenv/config";

import {
  scheduleSourcePollRepeatable,
  getSourcePollQueue,
  closeSourcePollQueue,
  SOURCE_POLL_QUEUE_NAME,
} from "../jobs/ingestion/sourcePollQueue";
import { getRedis } from "../lib/redis";
import { pool } from "../db";

async function main(): Promise<void> {
  console.log(
    `[cadence] queue name from production: ${SOURCE_POLL_QUEUE_NAME}`,
  );
  console.log("[cadence] invoking scheduleSourcePollRepeatable");
  const result = await scheduleSourcePollRepeatable();
  console.log(`[cadence] result: ${JSON.stringify(result)}`);

  const queue = getSourcePollQueue();
  if (!queue) {
    console.error("[cadence] queue null — aborting");
    process.exitCode = 1;
    return;
  }
  console.log("[cadence] querying getRepeatableJobs");
  const jobs = await queue.getRepeatableJobs();
  console.log(`[cadence] count: ${jobs.length}`);
  for (const j of jobs) {
    console.log(
      `[cadence-job] ${JSON.stringify({
        name: j.name,
        every: j.every,
        pattern: j.pattern,
        key: j.key,
      })}`,
    );
  }
  await closeSourcePollQueue();
  await pool.end().catch(() => undefined);
  const redis = getRedis();
  if (redis) await redis.quit().catch(() => undefined);
}

main().catch((err) => {
  console.error("[cadence] FATAL:", err);
  process.exitCode = 1;
});
