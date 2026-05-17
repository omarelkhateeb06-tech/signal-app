import "dotenv/config";
import { createApp } from "./app";
import { initSentry } from "./lib/sentry";
import { runStartupEnvCheck } from "./lib/envCheck";
import { startEmailWorker } from "./jobs/emailWorker";
import { startEmailScheduler } from "./jobs/emailScheduler";
import { startAggregationWorker } from "./jobs/aggregationWorker";
import { scheduleAggregationRepeatable } from "./jobs/aggregationQueue";
import { startSourcePollWorker } from "./jobs/ingestion/sourcePollWorker";
import { scheduleSourcePollRepeatable } from "./jobs/ingestion/sourcePollQueue";
import { startEnrichmentWorker } from "./jobs/ingestion/enrichmentWorker";
import { startEnrichmentRecoveryScheduler } from "./jobs/ingestion/enrichmentRecoveryScheduler";

initSentry();
runStartupEnvCheck();

const port = Number(process.env.PORT ?? 3001);
const app = createApp();

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`[signal-backend] listening on http://localhost:${port}`);
});

startEmailWorker();
startEmailScheduler();
startAggregationWorker();
void scheduleAggregationRepeatable().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error("[signal-backend] failed to schedule aggregation cron:", err);
});

// Phase 12e.1 — ingestion pipeline. Both workers degrade gracefully
// when REDIS_URL is unset (matches existing pattern). 12e.5c sub-step
// 5 adds per-source cadence scheduling: scheduleSourcePollRepeatable
// creates one BullMQ repeatable job per enabled source, cadence driven
// by ingestion_sources.fetch_interval_seconds.
startSourcePollWorker();
startEnrichmentWorker();
void scheduleSourcePollRepeatable().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(
    "[signal-backend] failed to schedule source-poll cadences:",
    err,
  );
});
// Phase 12e.x fix cluster — enrichment recovery cron. Fires every
// 6h, re-enqueues candidates with partial tier_outputs (Haiku timed
// out on one tier; the rest landed). Idempotent + capped at 3
// attempts per candidate. See jobs/ingestion/enrichmentRecovery.ts.
startEnrichmentRecoveryScheduler();

// eslint-disable-next-line no-console
console.log("[signal-backend] ingestion workers online");

export { app };
