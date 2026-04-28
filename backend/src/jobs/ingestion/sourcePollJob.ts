// Pure job body for the source-poll stage — Redis-free, CLI-runnable
// per CLAUDE.md §16. The worker (`sourcePollWorker.ts`) is a thin
// adapter that dispatches BullMQ jobs into this function; CLI scripts
// (`runIngestionPoll.ts`) call it directly with no queue plumbing.
//
// 12e.2 — fills in the real dispatch path:
//   1. Look up the source row.
//   2. Get the adapter from the registry. Null slot → no-op result with
//      failureReason "adapter_not_implemented" (guards arxiv/edgar/hn/
//      reddit until those ship).
//   3. Call the adapter. On success: persist candidates, reset failure
//      counter, update last_polled_at.
//   4. On adapter throw: increment failure counter, set last_polled_at,
//      surface failureReason. Do NOT rethrow — caller (worker or CLI)
//      logs and decides what to do.
//
// Dedup is enforced at the DB level by UNIQUE (ingestion_source_id,
// external_id); we use insert().onConflictDoNothing() so a re-poll over
// already-ingested items is a no-op.

import { eq, sql } from "drizzle-orm";

import { db } from "../../db";
import { ingestionCandidates, ingestionSources } from "../../db/schema";
import type { Candidate } from "./types";
import type { AdapterContext } from "./types";
import { getAdapter } from "./adapters";
import { enqueueEnrichment } from "./enrichmentQueue";

export interface SourcePollJobInput {
  sourceId: string;
  triggeredBy?: "cron" | "cli" | "test";
}

export interface SourcePollJobResult {
  sourceId: string;
  candidatesDiscovered: number;
  candidatesPersisted: number;
  // Set when the adapter throws or the slot is unimplemented. Non-null
  // reasons feed `ingestion_sources.consecutive_failure_count` and the
  // source-level kill switch (12e.8). Stable strings — see rss.ts for
  // the adapter-thrown set; "adapter_not_implemented" added here.
  failureReason: string | null;
}

async function loadSource(sourceId: string) {
  const rows = await db
    .select()
    .from(ingestionSources)
    .where(eq(ingestionSources.id, sourceId))
    .limit(1);
  return rows[0] ?? null;
}

async function persistCandidates(
  sourceId: string,
  candidates: readonly Candidate[],
): Promise<string[]> {
  if (candidates.length === 0) return [];

  const rows = candidates.map((c) => ({
    ingestionSourceId: sourceId,
    externalId: c.externalId,
    url: c.url,
    rawTitle: c.title,
    rawSummary: c.summary,
    rawPublishedAt: c.publishedAt,
    rawPayload: c.rawPayload,
    contentHash: c.contentHash,
  }));

  // onConflictDoNothing on the (ingestion_source_id, external_id) unique
  // constraint. Returning the inserted ids lets us count only new rows
  // and feed them into the enrichment-queue bridge below.
  const inserted = await db
    .insert(ingestionCandidates)
    .values(rows)
    .onConflictDoNothing({
      target: [ingestionCandidates.ingestionSourceId, ingestionCandidates.externalId],
    })
    .returning({ id: ingestionCandidates.id });

  return inserted.map((r) => r.id);
}

async function markSuccess(sourceId: string): Promise<void> {
  await db
    .update(ingestionSources)
    .set({
      consecutiveFailureCount: 0,
      lastPolledAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(ingestionSources.id, sourceId));
}

async function markFailure(sourceId: string): Promise<void> {
  await db
    .update(ingestionSources)
    .set({
      consecutiveFailureCount: sql`${ingestionSources.consecutiveFailureCount} + 1`,
      lastPolledAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(ingestionSources.id, sourceId));
}

export async function processSourcePollJob(
  input: SourcePollJobInput,
): Promise<SourcePollJobResult> {
  const source = await loadSource(input.sourceId);
  if (!source) {
    throw new Error(`source not found: ${input.sourceId}`);
  }

  const adapter = getAdapter(source.adapterType);
  if (!adapter) {
    // Don't touch counters / last_polled_at — this isn't a fetch outcome,
    // it's a "this adapter type isn't shipped yet" no-op. CLI / tests
    // still get a structured result they can act on.
    return {
      sourceId: source.id,
      candidatesDiscovered: 0,
      candidatesPersisted: 0,
      failureReason: "adapter_not_implemented",
    };
  }

  const ctx: AdapterContext = {
    sourceId: source.id,
    slug: source.slug,
    adapterType: source.adapterType,
    endpoint: source.endpoint,
    config: source.config,
    lastPolledAt: source.lastPolledAt,
  };

  let candidates: readonly Candidate[];
  try {
    const result = await adapter(ctx);
    candidates = result.candidates;
  } catch (err) {
    await markFailure(source.id);
    const reason = err instanceof Error ? err.message : "network";
    return {
      sourceId: source.id,
      candidatesDiscovered: 0,
      candidatesPersisted: 0,
      failureReason: reason,
    };
  }

  const insertedIds = await persistCandidates(source.id, candidates);
  await markSuccess(source.id);

  // Best-effort tail: enqueue an enrichment job per newly-inserted
  // candidate. Persist already succeeded; if enqueue throws (Redis
  // hiccup, transient queue error), log and continue — a future
  // scanner / 12e.5c orchestration sweeps any missed candidates.
  for (const candidateId of insertedIds) {
    try {
      await enqueueEnrichment({ candidateId, triggeredBy: "poll" });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `[ingestion-poll] enqueue failed for candidate ${candidateId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return {
    sourceId: source.id,
    candidatesDiscovered: candidates.length,
    candidatesPersisted: insertedIds.length,
    failureReason: null,
  };
}
