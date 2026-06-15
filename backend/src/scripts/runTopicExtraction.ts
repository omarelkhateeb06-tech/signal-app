// Manual trigger / backfill for topic extraction ("In Focus" chips).
//
// Drains events with no topics yet (topics_extracted_at IS NULL), oldest-first,
// via runTopicExtraction. Default runs a single batch; --all loops until the
// queue is drained. Requires ANTHROPIC_API_KEY (extraction is a Haiku call);
// without it every event soft-fails and nothing is written.
//
// Usage:
//   npm run run-topic-extraction --workspace=backend
//   npm run run-topic-extraction --workspace=backend -- --all
//
// Shutdown: clean teardown via try/finally; no process.exit(0) (see the
// libuv-on-Windows note in runNativeGeneration.ts).

import "../lib/loadEnv";

import { pool } from "../db";
import {
  runTopicExtraction,
  TOPIC_EXTRACTION_BATCH,
} from "../jobs/ingestion/topicExtractionJob";

async function main(): Promise<void> {
  /* eslint-disable no-console */
  try {
    const all = process.argv.includes("--all");
    if (!process.env.ANTHROPIC_API_KEY?.trim()) {
      console.warn(
        "[run-topic-extraction] ANTHROPIC_API_KEY not set — every event will soft-fail (nothing written).",
      );
    }

    let totalProcessed = 0;
    let totalUpdated = 0;
    let batchNo = 0;
    for (;;) {
      batchNo += 1;
      const { processed, updated } = await runTopicExtraction();
      totalProcessed += processed;
      totalUpdated += updated;
      console.log(
        `[run-topic-extraction] batch ${batchNo}: processed=${processed} updated=${updated}`,
      );
      // Stop after one batch unless --all; with --all, stop once a batch comes
      // back short (the queue is drained).
      if (!all || processed < TOPIC_EXTRACTION_BATCH) break;
    }
    console.log(
      `[run-topic-extraction] done: processed=${totalProcessed} updated=${totalUpdated}`,
    );
  } finally {
    await pool.end().catch(() => undefined);
  }
  /* eslint-enable no-console */
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(
      "[run-topic-extraction] fatal:",
      err instanceof Error ? err.message : err,
    );
    process.exitCode = 1;
  });
}
