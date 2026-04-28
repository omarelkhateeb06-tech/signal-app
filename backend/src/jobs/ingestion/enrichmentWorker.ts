// `signal-ingestion-enrich` worker. Receives one job per candidate
// surviving the heuristic filter and runs it through `processEnrichmentJob`.
// 12e.1 ships a thin shell; 12e.3 onward fills in the pipeline through
// the enrichmentJob seams.

import { Worker, type Job } from "bullmq";
import { getRedis, isRedisConfigured } from "../../lib/redis";
import { ENRICHMENT_QUEUE_NAME } from "./enrichmentQueue";
import { processEnrichmentJob, type EnrichmentJobInput } from "./enrichmentJob";

let cachedWorker: Worker<EnrichmentJobInput> | null = null;

async function handle(job: Job<EnrichmentJobInput>): Promise<void> {
  // 12e.5c: wire seams here (runHeuristic, runRelevanceGate, etc.).
  // Until then, this worker returns terminalStatus: "failed" for any
  // drained job because seams are not injected. The CLI
  // (runIngestionEnrich.ts) is the documented dev surface for 12e.3
  // and 12e.4 — it injects the heuristic + relevance seams directly.
  // No DB corruption: the orchestration body's missing-seam guard
  // returns the structured result without writing to the DB.
  const result = await processEnrichmentJob(job.data);
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
