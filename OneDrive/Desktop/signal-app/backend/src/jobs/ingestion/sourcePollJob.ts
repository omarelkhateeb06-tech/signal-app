// Pure job body for the source-poll stage — Redis-free, CLI-runnable
// per CLAUDE.md §17. The worker (`sourcePollWorker.ts`) is a thin
// adapter that dispatches BullMQ jobs into this function; CLI scripts
// (e.g. a `runIngestionPoll` invocation in 12e.2) will call it
// directly with no queue plumbing.
//
// 12e.1 ships the seam only: input shape, return shape, no-op body.
// 12e.2 onward fills in adapter dispatch → ingestion_candidates write.

export interface SourcePollJobInput {
  sourceId: string;
  triggeredBy?: "cron" | "cli" | "test";
}

export interface SourcePollJobResult {
  sourceId: string;
  candidatesDiscovered: number;
  candidatesPersisted: number;
  // Set when the adapter throws or returns a recognized failure shape.
  // Non-null reasons feed `ingestion_sources.consecutive_failure_count`
  // and the source-level kill switch (12e.8).
  failureReason: string | null;
}

export async function processSourcePollJob(
  input: SourcePollJobInput,
): Promise<SourcePollJobResult> {
  // Phase 12e.1 — scaffolding only. 12e.2 replaces this with:
  //   1. SELECT ingestion_sources WHERE id = input.sourceId
  //   2. dispatch via getAdapter(row.adapter_type)
  //   3. dedupe + INSERT into ingestion_candidates
  //   4. UPDATE ingestion_sources.last_polled_at + reset
  //      consecutive_failure_count, OR increment + set failureReason
  return {
    sourceId: input.sourceId,
    candidatesDiscovered: 0,
    candidatesPersisted: 0,
    failureReason: null,
  };
}
