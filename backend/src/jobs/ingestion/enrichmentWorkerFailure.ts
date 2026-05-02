// Phase 12e.5c sub-step 7 — BullMQ `failed` event handler for the
// enrichment worker, factored out of enrichmentWorker.ts so it's
// testable without pulling in the heuristic seam's jsdom transitive
// (see docs/discovery/phase-12e5b-audit.md §10 + the parallel split
// in tierOrchestration.ts:1-19 for the same hygiene boundary).
//
// The split is purely a test-import hygiene boundary; runtime
// semantics are unchanged from the prior in-line on("failed", ...)
// handler.
//
// Contract:
//   - Logs the failure to console (preserved from the prior handler).
//   - Best-effort source_slug lookup so the Sentry tag set matches
//     sub-step 6's per-stage convention. DB hiccup mid-failure → tag
//     omitted, capture still fires (we're already in a failure handler;
//     compounding the failure with a DB-error throw would lose the
//     original error context).
//   - Captures via captureIngestionStageFailure with stage='worker_failed'
//     plus extraTags carrying BullMQ context (attempt count + queue name).
//   - The failed job remains in BullMQ's failed-state for 7 days per
//     the queue's `removeOnFail: { age: 604_800 }` config — that IS the
//     DLQ. Audit §2 confirmed no separate dead_letter table is needed;
//     same pattern as signal-emails and signal-aggregation.

import { eq } from "drizzle-orm";
import type { Job } from "bullmq";

import { db as defaultDb } from "../../db";
import { ingestionCandidates, ingestionSources } from "../../db/schema";
import { captureIngestionStageFailure } from "../../lib/sentryHelpers";
import { ENRICHMENT_QUEUE_NAME } from "./enrichmentQueue";
import type { EnrichmentJobInput } from "./enrichmentJob";

export interface HandleWorkerFailureDeps {
  db?: typeof defaultDb;
  captureFailure?: typeof captureIngestionStageFailure;
}

export async function handleWorkerFailure(
  job: Job<EnrichmentJobInput> | undefined,
  err: Error,
  deps: HandleWorkerFailureDeps = {},
): Promise<void> {
  const candidateId = job?.data.candidateId ?? "unknown";
  // eslint-disable-next-line no-console
  console.error(
    `[signal-backend] [ingestion-enrich:failed] candidate=${candidateId}: ${err.message}`,
  );

  let sourceSlug: string | null = null;
  if (job?.data.candidateId) {
    try {
      const dbInstance = deps.db ?? defaultDb;
      const rows = await dbInstance
        .select({ slug: ingestionSources.slug })
        .from(ingestionCandidates)
        .leftJoin(
          ingestionSources,
          eq(ingestionSources.id, ingestionCandidates.ingestionSourceId),
        )
        .where(eq(ingestionCandidates.id, job.data.candidateId))
        .limit(1);
      sourceSlug =
        (rows[0] as { slug: string | null } | undefined)?.slug ?? null;
    } catch {
      // Swallow lookup errors — we're already in a failure handler;
      // compounding the failure with a DB-error throw would lose the
      // original error context. sourceSlug stays null.
    }
  }

  const captureFailure = deps.captureFailure ?? captureIngestionStageFailure;
  captureFailure({
    stage: "worker_failed",
    candidateId,
    sourceSlug,
    rejectionReason: err.message || "unknown_error",
    err,
    extraTags: {
      "bullmq.attempt": String(job?.attemptsMade ?? 0),
      "bullmq.queue": ENRICHMENT_QUEUE_NAME,
    },
  });
}
