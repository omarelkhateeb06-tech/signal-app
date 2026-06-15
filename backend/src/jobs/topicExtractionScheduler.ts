import cron, { type ScheduledTask } from "node-cron";
import { runTopicExtraction } from "./ingestion/topicExtractionJob";

// Phase 12 — recurring topic extraction for the "In Focus" chips.
//
// Topic extraction is an LLM call per event, deliberately kept off the
// ingestion write path (see topicExtractionJob). This scheduler drains
// not-yet-attempted events in bounded batches so new events pick up topics
// within a cadence, and the one-time backfill of the existing corpus completes
// on its own over a few runs. Mirrors nativeGenerationScheduler: a thin
// node-cron wrapper with an env-overridable cron, a disable flag, and a hard
// skip when ANTHROPIC_API_KEY is unset (extraction is a Haiku call).
//
// Default every 30 minutes; override with TOPIC_EXTRACTION_CRON.
const TOPIC_EXTRACTION_CRON = process.env.TOPIC_EXTRACTION_CRON ?? "*/30 * * * *";

let cachedTask: ScheduledTask | null = null;

export function startTopicExtractionScheduler(): ScheduledTask | null {
  if (cachedTask) return cachedTask;
  if (process.env.DISABLE_TOPIC_SCHEDULER === "1") {
    // eslint-disable-next-line no-console
    console.warn(
      "[signal-backend] topic extraction scheduler disabled via DISABLE_TOPIC_SCHEDULER",
    );
    return null;
  }
  if (!cron.validate(TOPIC_EXTRACTION_CRON)) {
    // eslint-disable-next-line no-console
    console.error(
      `[signal-backend] invalid TOPIC_EXTRACTION_CRON: ${TOPIC_EXTRACTION_CRON}`,
    );
    return null;
  }

  cachedTask = cron.schedule(
    TOPIC_EXTRACTION_CRON,
    async () => {
      const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
      if (!apiKey) {
        // eslint-disable-next-line no-console
        console.warn(
          "[signal-backend] [scheduler] topic extraction skipped — ANTHROPIC_API_KEY not set",
        );
        return;
      }
      try {
        const result = await runTopicExtraction();
        // eslint-disable-next-line no-console
        console.log(
          `[signal-backend] [scheduler] topic extraction run: ` +
            `processed=${result.processed} updated=${result.updated}`,
        );
      } catch (err) {
        // A failure must never crash the scheduler — log and let the next
        // cadence retry.
        // eslint-disable-next-line no-console
        console.error(
          "[signal-backend] [scheduler] topic extraction failed:",
          err,
        );
      }
    },
    { timezone: "UTC" },
  );

  // eslint-disable-next-line no-console
  console.log(
    `[signal-backend] topic extraction scheduler started (cron="${TOPIC_EXTRACTION_CRON}" tz=UTC)`,
  );
  return cachedTask;
}

export function stopTopicExtractionScheduler(): void {
  if (cachedTask) {
    cachedTask.stop();
    cachedTask = null;
  }
}
