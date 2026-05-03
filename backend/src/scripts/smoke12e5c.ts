// Phase 12e.5c sub-step 8 — live ephemeral-Docker smoke harness.
//
// Triggers ingestion via a custom BullMQ Worker that mirrors
// `startEnrichmentWorker` (enrichmentWorker.ts) EXACTLY except for one
// dep injection: `writeEvent` is wrapped with a candidate-targeted
// failure for the forced-injection scenario per #64.
//
// Production source files are NOT modified. The harness uses
// `processEnrichmentJob`'s existing `deps.writeEvent` injection seam
// (added in sub-step 3 for testability) to attach the wrapper.
//
// Mirror points (verbatim from enrichmentWorker.ts):
//   - Queue name: ENRICHMENT_QUEUE_NAME from enrichmentQueue.ts.
//   - Connection: getRedis() from lib/redis.ts.
//   - Concurrency: process.env.INGESTION_ENRICH_CONCURRENCY ?? 2.
//   - Seam construction: identical (heuristic + relevance + facts as
//     the three production seams; processTier + writeEvent default to
//     production via processEnrichmentJob's internal fallback).
//   - Failed handler: handleWorkerFailure from enrichmentWorkerFailure.ts.
//   - triggeredBy: defaults to 'poll' if producer didn't set.
//
// Sole divergence from production: `deps.writeEvent` is overridden
// with a wrapper that throws a synthesized PG-style error for one
// target candidate ID; passes through to the real `writeEvent` for
// every other candidate.
//
// Phases (single invocation walks all):
//   poll  — call processSourcePollJob directly for the 3 sources
//   pick  — pick injection target candidate (first with body_text + sector set)
//   run1  — boot worker (with injection), enqueue all candidates, drain
//   run2  — re-enqueue all candidates with the same worker, drain
//   run3  — rewind one published candidate to facts_extracted, re-enqueue
//   verify — query DB for invariants
//   teardown — stop worker, close connections
//
// All phases emit structured JSON snapshots to stdout for the smoke
// writeup to consume.

import "dotenv/config";

import { Worker, type Job } from "bullmq";
import { eq, sql, inArray, gte, asc } from "drizzle-orm";

import { initSentry } from "../lib/sentry";
import { db, pool } from "../db";
import {
  events,
  eventSources,
  ingestionCandidates,
  ingestionSources,
} from "../db/schema";
import { getRedis, isRedisConfigured } from "../lib/redis";
import {
  ENRICHMENT_QUEUE_NAME,
  enqueueEnrichment,
  getEnrichmentQueue,
} from "../jobs/ingestion/enrichmentQueue";
import {
  processEnrichmentJob,
  type EnrichmentJobInput,
  type EnrichmentSeams,
} from "../jobs/ingestion/enrichmentJob";
import { runHeuristicSeam } from "../jobs/ingestion/heuristicSeam";
import { runRelevanceSeam } from "../jobs/ingestion/relevanceSeam";
import { runFactsSeam } from "../jobs/ingestion/factsSeam";
import { handleWorkerFailure } from "../jobs/ingestion/enrichmentWorkerFailure";
import { writeEvent as defaultWriteEvent } from "../jobs/ingestion/writeEvent";
import { processSourcePollJob } from "../jobs/ingestion/sourcePollJob";

const TARGET_SOURCES = ["cnbc-markets", "import-ai", "semianalysis"];

// Set to a candidate ID after the pick phase — the writeEvent wrapper
// throws ONLY for this ID. All other candidates use real writeEvent.
let TARGET_FAILURE_CANDIDATE_ID: string | null = null;

function logSection(title: string): void {
  console.log("\n========================================");
  console.log("== " + title);
  console.log("========================================");
}

function logSnapshot(label: string, payload: unknown): void {
  console.log(`[smoke-snapshot] ${label}: ${JSON.stringify(payload)}`);
}

// ============================================================================
// Custom worker construction — mirrors startEnrichmentWorker EXACTLY
// except for the writeEvent injection.
// ============================================================================

const seams: EnrichmentSeams = {
  runHeuristic: (id) => runHeuristicSeam(id),
  runRelevanceGate: (id) => runRelevanceSeam(id),
  extractFacts: (id) => runFactsSeam(id),
};

const wrappedWriteEvent: typeof defaultWriteEvent = async (
  candidateId,
  writeDeps,
) => {
  if (
    TARGET_FAILURE_CANDIDATE_ID !== null &&
    candidateId === TARGET_FAILURE_CANDIDATE_ID
  ) {
    // Synthesized PG-style error per the brief's option (a):
    // "wrap the PG client used by writeEvent at the smoke driver level
    // for one specific candidate ID, returning a transient connection
    // error on its first call."
    throw new Error(
      `connection terminated unexpectedly during writeEvent (smoke-injected for candidate ${candidateId})`,
    );
  }
  return defaultWriteEvent(candidateId, writeDeps);
};

async function bootWorker(): Promise<Worker<EnrichmentJobInput>> {
  if (!isRedisConfigured()) {
    throw new Error("Redis not configured — smoke requires REDIS_URL");
  }
  const connection = getRedis();
  if (!connection) {
    throw new Error("getRedis() returned null");
  }

  const worker = new Worker<EnrichmentJobInput>(
    ENRICHMENT_QUEUE_NAME,
    async (job: Job<EnrichmentJobInput>) => {
      const result = await processEnrichmentJob(
        { ...job.data, triggeredBy: job.data.triggeredBy ?? "poll" },
        { seams, writeEvent: wrappedWriteEvent },
      );
      console.log(
        `[signal-backend] [ingestion-enrich:done] candidate=${result.candidateId} terminal=${result.terminalStatus} event=${result.resolvedEventId ?? "none"} failure=${result.failureReason ?? "none"}`,
      );
    },
    {
      connection,
      concurrency: Number(process.env.INGESTION_ENRICH_CONCURRENCY ?? 2),
    },
  );
  worker.on("failed", (job, err) => {
    void handleWorkerFailure(job, err);
  });
  console.log("[smoke] custom worker booted (mirroring startEnrichmentWorker)");
  return worker;
}

// ============================================================================
// Phase: poll all 3 sources
// ============================================================================

async function phasePoll(): Promise<{ totalDiscovered: number }> {
  logSection("PHASE: POLL");
  let totalDiscovered = 0;
  for (const slug of TARGET_SOURCES) {
    const sourceRows = await db
      .select({ id: ingestionSources.id })
      .from(ingestionSources)
      .where(eq(ingestionSources.slug, slug))
      .limit(1);
    const sourceId = sourceRows[0]?.id;
    if (!sourceId) {
      console.log(`[smoke] source not found: ${slug}`);
      continue;
    }
    const result = await processSourcePollJob({
      sourceId,
      triggeredBy: "test",
    });
    totalDiscovered += result.candidatesPersisted;
    logSnapshot(`poll.${slug}`, result);
  }
  return { totalDiscovered };
}

// ============================================================================
// Phase: pick injection target candidate
// ============================================================================

async function phasePickTarget(): Promise<string | null> {
  logSection("PHASE: PICK INJECTION TARGET");
  // Pick a cnbc-markets candidate with raw_published_at in the last
  // 24 hours so it's likely to pass the heuristic recency check (36h
  // window per `heuristics.ts`). Sort by raw_published_at DESC to
  // prefer the freshest article — most likely to survive heuristic +
  // relevance + facts and reach writeEvent (where the injection fires).
  const cnbcRows = await db
    .select({ id: ingestionSources.id })
    .from(ingestionSources)
    .where(eq(ingestionSources.slug, "cnbc-markets"))
    .limit(1);
  const cnbcId = cnbcRows[0]?.id;
  if (!cnbcId) {
    console.log("[smoke] cnbc-markets source not found — cannot pick target");
    return null;
  }
  const candidates = await db.execute(
    sql`SELECT id, raw_title, raw_published_at FROM ingestion_candidates
        WHERE ingestion_source_id = ${cnbcId}
          AND raw_published_at IS NOT NULL
          AND raw_published_at > now() - interval '24 hours'
        ORDER BY raw_published_at DESC
        LIMIT 1`,
  );
  const target = candidates.rows[0] as
    | { id: string; raw_title: string | null; raw_published_at: Date }
    | undefined;
  if (!target) {
    console.log(
      "[smoke] no cnbc-markets candidate with raw_published_at within 24h — cannot pick target for injection",
    );
    return null;
  }
  TARGET_FAILURE_CANDIDATE_ID = target.id;
  logSnapshot("inject.target", {
    candidateId: target.id,
    rawTitle: target.raw_title,
    rawPublishedAt: target.raw_published_at?.toISOString?.() ?? String(target.raw_published_at),
  });
  return target.id;
}

// ============================================================================
// Helper: wait for queue to drain
// ============================================================================

async function waitForDrain(
  label: string,
  timeoutMs = 15 * 60 * 1000,
): Promise<void> {
  const queue = getEnrichmentQueue();
  if (!queue) throw new Error("queue unavailable");
  const start = Date.now();
  let lastLog = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const counts = await queue.getJobCounts(
      "active",
      "waiting",
      "delayed",
    );
    const remaining = counts.active + counts.waiting + counts.delayed;
    const now = Date.now();
    if (now - lastLog > 10_000) {
      console.log(
        `[smoke] [${label}] drain wait — active=${counts.active} waiting=${counts.waiting} delayed=${counts.delayed} elapsed=${Math.round((now - start) / 1000)}s`,
      );
      lastLog = now;
    }
    if (remaining === 0) {
      // Wait one more cycle to ensure any post-completion writes settle.
      await new Promise((r) => setTimeout(r, 2000));
      const recheck = await queue.getJobCounts("active", "waiting", "delayed");
      if (recheck.active + recheck.waiting + recheck.delayed === 0) {
        console.log(
          `[smoke] [${label}] drained in ${Math.round((Date.now() - start) / 1000)}s`,
        );
        return;
      }
    }
    if (now - start > timeoutMs) {
      throw new Error(`[smoke] [${label}] drain timeout after ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
}

// ============================================================================
// Helper: snapshot current state
// ============================================================================

interface StateSnapshot {
  candidatesByStatus: Record<string, number>;
  eventsCount: number;
  eventSourcesCount: number;
  candidatesProcessedSince?: number;
}

async function snapshotState(since?: Date): Promise<StateSnapshot> {
  const byStatusRaw = await db
    .select({
      status: ingestionCandidates.status,
      count: sql<number>`count(*)::int`,
    })
    .from(ingestionCandidates)
    .groupBy(ingestionCandidates.status);
  const candidatesByStatus: Record<string, number> = {};
  for (const row of byStatusRaw) {
    candidatesByStatus[row.status] = Number(row.count);
  }
  const eventsCountRaw = await db.execute(
    sql`SELECT count(*)::int AS c FROM events`,
  );
  const eventSourcesCountRaw = await db.execute(
    sql`SELECT count(*)::int AS c FROM event_sources`,
  );
  const eventsCount = Number(
    (eventsCountRaw.rows[0] as { c: number } | undefined)?.c ?? 0,
  );
  const eventSourcesCount = Number(
    (eventSourcesCountRaw.rows[0] as { c: number } | undefined)?.c ?? 0,
  );
  const snap: StateSnapshot = {
    candidatesByStatus,
    eventsCount,
    eventSourcesCount,
  };
  if (since) {
    const processedSinceRaw = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(ingestionCandidates)
      .where(gte(ingestionCandidates.processedAt, since));
    snap.candidatesProcessedSince = Number(
      (processedSinceRaw[0] as { count: number } | undefined)?.count ?? 0,
    );
  }
  return snap;
}

// ============================================================================
// Phase: enqueue all eligible candidates and drain
// ============================================================================

async function enqueueAllCandidates(
  candidateIds: string[],
  label: string,
): Promise<{ enqueued: number }> {
  for (const id of candidateIds) {
    await enqueueEnrichment({ candidateId: id, triggeredBy: "test" });
  }
  console.log(`[smoke] [${label}] enqueued ${candidateIds.length} jobs`);
  return { enqueued: candidateIds.length };
}

async function getAllCandidateIds(): Promise<string[]> {
  const rows = await db
    .select({ id: ingestionCandidates.id })
    .from(ingestionCandidates)
    .innerJoin(
      ingestionSources,
      eq(ingestionSources.id, ingestionCandidates.ingestionSourceId),
    )
    .where(inArray(ingestionSources.slug, TARGET_SOURCES))
    .orderBy(asc(ingestionCandidates.discoveredAt));
  return rows.map((r) => r.id);
}

// ============================================================================
// Phase: run3 — rewind one published candidate to facts_extracted
// ============================================================================

async function phaseRewindForRun3(): Promise<string | null> {
  logSection("PHASE: RUN 3 PREP — REWIND ONE PUBLISHED CANDIDATE");
  const published = await db
    .select({
      id: ingestionCandidates.id,
      resolvedEventId: ingestionCandidates.resolvedEventId,
    })
    .from(ingestionCandidates)
    .where(eq(ingestionCandidates.status, "published"))
    .limit(5);
  // Pick the FIRST published candidate that's not the injection target.
  const pick = published.find((p) => p.id !== TARGET_FAILURE_CANDIDATE_ID);
  if (!pick) {
    console.log("[smoke] no published candidate to rewind — skipping run3");
    return null;
  }
  // Rewind: set status='facts_extracted', clear resolved_event_id +
  // tier_outputs (so tier orchestration re-runs the full trio). We
  // KEEP llm_judgment_raw + facts + facts_extracted_at so the per-stage
  // short-circuit fires (relevance + facts skip).
  await db
    .update(ingestionCandidates)
    .set({
      status: "facts_extracted",
      resolvedEventId: null,
      tierOutputs: null,
      tierGeneratedAt: null,
      tierOutputsRaw: null,
      processedAt: null,
    })
    .where(eq(ingestionCandidates.id, pick.id));
  // Also delete the events + event_sources rows so we can verify
  // writeEvent re-fires.
  if (pick.resolvedEventId) {
    await db.delete(eventSources).where(eq(eventSources.eventId, pick.resolvedEventId));
    await db.delete(events).where(eq(events.id, pick.resolvedEventId));
  }
  logSnapshot("run3.rewound", { candidateId: pick.id });
  return pick.id;
}

// ============================================================================
// Phase: cadence verification
// ============================================================================

async function phaseCadenceVerify(): Promise<unknown> {
  logSection("PHASE: CADENCE VERIFICATION");
  // The smoke harness doesn't boot scheduleSourcePollRepeatable —
  // verifying its scheduling output is a separate smoke. Instead, we
  // verify the function would produce the right per-source schedules
  // by querying the source rows and computing the expected `every` ms.
  const sources = await db
    .select({
      slug: ingestionSources.slug,
      enabled: ingestionSources.enabled,
      fetchIntervalSeconds: ingestionSources.fetchIntervalSeconds,
    })
    .from(ingestionSources)
    .where(inArray(ingestionSources.slug, TARGET_SOURCES));
  const expected = sources.map((s) => ({
    slug: s.slug,
    enabled: s.enabled,
    expectedEveryMs: s.fetchIntervalSeconds * 1000,
    expectedJobId: `repeat:poll:${s.slug}`,
  }));
  logSnapshot("cadence.expected", expected);
  return expected;
}

// ============================================================================
// Phase: writeEvent invariants — sample published candidates
// ============================================================================

interface InvariantSample {
  candidateId: string;
  eventId: string;
  whyItMattersFromTier: "briefed" | "accessible" | "technical" | "synthesized";
  whyItMattersStartsWith: string;
  contextSource: "raw_summary" | "body_text_truncated";
  publishedAtMatch: boolean;
  rawPublishedAt: string | null;
  eventPublishedAt: string | null;
}

async function phaseInvariants(): Promise<InvariantSample[]> {
  logSection("PHASE: WRITE_EVENT INVARIANTS — SAMPLE 5");
  const rows = await db
    .select({
      candidateId: ingestionCandidates.id,
      resolvedEventId: ingestionCandidates.resolvedEventId,
      tierOutputs: ingestionCandidates.tierOutputs,
      rawTitle: ingestionCandidates.rawTitle,
      rawSummary: ingestionCandidates.rawSummary,
      bodyText: ingestionCandidates.bodyText,
      rawPublishedAt: ingestionCandidates.rawPublishedAt,
    })
    .from(ingestionCandidates)
    .where(eq(ingestionCandidates.status, "published"))
    .limit(10);
  const samples: InvariantSample[] = [];
  for (const row of rows.slice(0, 5)) {
    if (!row.resolvedEventId) continue;
    const evRows = await db
      .select({
        id: events.id,
        whyItMatters: events.whyItMatters,
        context: events.context,
        publishedAt: events.publishedAt,
      })
      .from(events)
      .where(eq(events.id, row.resolvedEventId))
      .limit(1);
    const ev = evRows[0];
    if (!ev) continue;

    // Determine which fallback level fired for why_it_matters.
    const tiers = row.tierOutputs as
      | { briefed?: { thesis?: string }; accessible?: { thesis?: string }; technical?: { thesis?: string } }
      | null;
    let level: InvariantSample["whyItMattersFromTier"];
    if (tiers?.briefed?.thesis === ev.whyItMatters) level = "briefed";
    else if (tiers?.accessible?.thesis === ev.whyItMatters) level = "accessible";
    else if (tiers?.technical?.thesis === ev.whyItMatters) level = "technical";
    else level = "synthesized";

    // Determine context source.
    const summaryTrim = (row.rawSummary ?? "").trim();
    const contextSource: InvariantSample["contextSource"] =
      summaryTrim.length > 0 && ev.context === summaryTrim
        ? "raw_summary"
        : "body_text_truncated";

    samples.push({
      candidateId: row.candidateId,
      eventId: ev.id,
      whyItMattersFromTier: level,
      whyItMattersStartsWith: ev.whyItMatters.slice(0, 80),
      contextSource,
      publishedAtMatch:
        (ev.publishedAt?.getTime() ?? -1) ===
        (row.rawPublishedAt?.getTime() ?? -1),
      rawPublishedAt: row.rawPublishedAt?.toISOString() ?? null,
      eventPublishedAt: ev.publishedAt?.toISOString() ?? null,
    });
  }
  for (const s of samples) {
    logSnapshot("invariant.sample", s);
  }
  return samples;
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  console.log("[smoke] Phase 12e.5c sub-step 8 harness starting");
  console.log(`[smoke] target sources: ${TARGET_SOURCES.join(", ")}`);

  // Initialize Sentry — no-op if SENTRY_DSN unset, real client if set.
  // Required for the per-stage capture in processEnrichmentJob and the
  // worker_failed handler to actually emit events to the dev Sentry
  // project (sub-step 8 step 9 verification).
  const sentryEnabled = initSentry();
  console.log(`[smoke] Sentry init: ${sentryEnabled ? "enabled" : "disabled (no DSN)"}`);

  // ---- Phase: poll ----
  const pollResult = await phasePoll();
  if (pollResult.totalDiscovered === 0) {
    console.log("[smoke] STOP: 0 candidates discovered across all sources");
    process.exit(2);
  }

  // ---- Phase: pick injection target ----
  await phasePickTarget();

  // ---- Boot worker ----
  const worker = await bootWorker();

  try {
    // ---- Run 1: enqueue all candidates ----
    logSection("PHASE: RUN 1 — HAPPY PATH WITH INJECTION");
    const run1Start = new Date();
    const allIds = await getAllCandidateIds();
    console.log(`[smoke] discovered ${allIds.length} candidates total`);
    if (allIds.length < 10) {
      console.log(
        `[smoke] STOP-AND-SURFACE: only ${allIds.length} candidates (<10 floor per brief stop-gates)`,
      );
      // Don't process.exit — proceed to capture state, then exit at end.
    }
    const beforeRun1 = await snapshotState();
    logSnapshot("run1.before", beforeRun1);
    await enqueueAllCandidates(allIds, "run1");
    await waitForDrain("run1");
    const afterRun1 = await snapshotState(run1Start);
    logSnapshot("run1.after", afterRun1);

    // ---- Run 2: re-enqueue all candidates, expect 0 Haiku/0 writes ----
    logSection("PHASE: RUN 2 — WHOLE-JOB SHORT-CIRCUIT");
    const run2Start = new Date();
    const beforeRun2 = await snapshotState();
    logSnapshot("run2.before", beforeRun2);
    await enqueueAllCandidates(allIds, "run2");
    await waitForDrain("run2");
    const afterRun2 = await snapshotState(run2Start);
    logSnapshot("run2.after", afterRun2);

    // ---- Run 3: rewind one published candidate, re-enqueue ----
    logSection("PHASE: RUN 3 — PER-STAGE SHORT-CIRCUIT");
    const rewoundId = await phaseRewindForRun3();
    if (rewoundId) {
      const run3Start = new Date();
      const beforeRun3 = await snapshotState();
      logSnapshot("run3.before", beforeRun3);
      await enqueueAllCandidates([rewoundId], "run3");
      await waitForDrain("run3");
      const afterRun3 = await snapshotState(run3Start);
      logSnapshot("run3.after", afterRun3);
      // Capture the rewound candidate's final state
      const finalRows = await db
        .select({
          status: ingestionCandidates.status,
          resolvedEventId: ingestionCandidates.resolvedEventId,
          tierOutputs: ingestionCandidates.tierOutputs,
        })
        .from(ingestionCandidates)
        .where(eq(ingestionCandidates.id, rewoundId))
        .limit(1);
      logSnapshot("run3.rewound_final", finalRows[0] ?? null);
    } else {
      console.log("[smoke] run3 skipped — no published candidate to rewind");
    }

    // ---- Forced-failure injection state check ----
    logSection("PHASE: INJECTION STATE — verify #64 hypothesis");
    if (TARGET_FAILURE_CANDIDATE_ID) {
      const injectedRows = await db
        .select({
          id: ingestionCandidates.id,
          status: ingestionCandidates.status,
          statusReason: ingestionCandidates.statusReason,
          resolvedEventId: ingestionCandidates.resolvedEventId,
          tierGeneratedAt: ingestionCandidates.tierGeneratedAt,
        })
        .from(ingestionCandidates)
        .where(eq(ingestionCandidates.id, TARGET_FAILURE_CANDIDATE_ID))
        .limit(1);
      const injState = injectedRows[0];
      if (injState) {
        // Also verify no events / event_sources rows were written for it
        let eventsForInjection = 0;
        if (injState.resolvedEventId) {
          const evCheck = await db.execute(
            sql`SELECT count(*)::int AS c FROM events WHERE id = ${injState.resolvedEventId}`,
          );
          eventsForInjection = Number(
            (evCheck.rows[0] as { c: number } | undefined)?.c ?? 0,
          );
        }
        logSnapshot("injection.candidate_state", {
          ...injState,
          eventsRowExists: eventsForInjection > 0,
        });
      }
    }

    // ---- Cadence verification ----
    await phaseCadenceVerify();

    // ---- writeEvent invariants ----
    await phaseInvariants();

    // ---- Final summary ----
    logSection("PHASE: FINAL");
    const finalSnap = await snapshotState();
    logSnapshot("final.state", finalSnap);
  } finally {
    console.log("[smoke] tearing down worker");
    await worker.close().catch(() => undefined);
    await pool.end().catch(() => undefined);
    const queue = getEnrichmentQueue();
    if (queue) await queue.close().catch(() => undefined);
    const redis = getRedis();
    if (redis) await redis.quit().catch(() => undefined);
  }

  console.log("[smoke] DONE");
}

main().catch((err) => {
  console.error("[smoke] FATAL:", err);
  process.exitCode = 1;
});
