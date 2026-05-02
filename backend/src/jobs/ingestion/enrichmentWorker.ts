// `signal-ingestion-enrich` worker. Receives one job per candidate
// surviving the heuristic filter and runs it through `processEnrichmentJob`.
// 12e.1 ships a thin shell; 12e.3 onward fills in the pipeline through
// the enrichmentJob seams. 12e.5c sub-step 4 wires the four seams +
// the tier orchestration + the events writer into the worker so
// BullMQ-drained jobs flow through the full chain end-to-end.

import { Worker, type Job } from "bullmq";
import { getRedis, isRedisConfigured } from "../../lib/redis";
import { ENRICHMENT_QUEUE_NAME } from "./enrichmentQueue";
import {
  processEnrichmentJob,
  type EnrichmentJobInput,
  type EnrichmentSeams,
} from "./enrichmentJob";
import { runHeuristicSeam } from "./heuristicSeam";
import { runRelevanceSeam } from "./relevanceSeam";
import { runFactsSeam } from "./factsSeam";

let cachedWorker: Worker<EnrichmentJobInput> | null = null;

// Module-level seam construction mirrors `scripts/runIngestionEnrich.ts`'s
// pattern. Each seam loads its own candidate row + makes its own LLM
// call internally — the orchestration body in processEnrichmentJob
// owns DB persistence + status transitions. The tier-generation +
// writeEvent stages don't appear here because processEnrichmentJob's
// EnrichmentJobDeps default to the production `processTierGeneration`
// (sub-step 2) and `writeEvent` (sub-step 3) when those deps are
// omitted. The CLI follows the same pattern.
const seams: EnrichmentSeams = {
  runHeuristic: (id) => runHeuristicSeam(id),
  runRelevanceGate: (id) => runRelevanceSeam(id),
  extractFacts: (id) => runFactsSeam(id),
};

async function handle(job: Job<EnrichmentJobInput>): Promise<void> {
  // Inject seams + mark `triggeredBy` as 'poll' if the producer didn't
  // already set it (sourcePollWorker enqueues with no triggeredBy
  // today; CLI sets 'cli'; tests set 'test'). The full chain runs
  // end-to-end: heuristic → relevance → facts → tiers → writeEvent →
  // status='published' on success. Failure modes return structured
  // result envelopes; only unexpected exceptions reach the BullMQ
  // failed handler (sub-step 7 wires that for Sentry capture).
  const result = await processEnrichmentJob(
    { ...job.data, triggeredBy: job.data.triggeredBy ?? "poll" },
    { seams },
  );
  // eslint-disable-next-line no-console
  console.log(
    `[signal-backend] [ingestion-enrich:done] candidate=${result.candidateId} terminal=${result.terminalStatus} event=${result.resolvedEventId ?? "none"} failure=${result.failureReason ?? "none"}`,
  );
}

export function startEnrichmentWorker(): Worker<EnrichmentJobInput> | null {
  if (cachedWorker) return cachedWorker;
  if (!isRedisConfigured()) {
    // eslint-disable-next-line no-console
    console.warn(
      "[signal-backend] enrichment worker not started (REDIS_URL not set)",
    );
    return null;
  }
  const connection = getRedis();
  if (!connection) return null;

  cachedWorker = new Worker<EnrichmentJobInput>(ENRICHMENT_QUEUE_NAME, handle, {
    connection,
    // Lower default than poll worker — Haiku rate limits + spend
    // governance per CLAUDE.md /  roadmap §5.4 cost notes.
    concurrency: Number(process.env.INGESTION_ENRICH_CONCURRENCY ?? 2),
  });
  cachedWorker.on("failed", (job, err) => {
    // eslint-disable-next-line no-console
    console.error(
      `[signal-backend] [ingestion-enrich:failed] candidate=${job?.data.candidateId ?? "unknown"}: ${err.message}`,
    );
  });
  // eslint-disable-next-line no-console
  console.log("[signal-backend] enrichment worker started");
  return cachedWorker;
}

export async function stopEnrichmentWorker(): Promise<void> {
  if (cachedWorker) {
    await cachedWorker.close().catch(() => undefined);
    cachedWorker = null;
  }
}
