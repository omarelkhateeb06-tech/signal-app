// Phase 12e.6 — live ephemeral-Docker smoke harness.
//
// Validates the full 12e.6 cluster end-to-end:
//   12e.6a — embedding seam + cosine cluster check
//   12e.6b — two-branch dispatch + source priority promotion
//   12e.6c — re-enrichment on attach + Redis rate limiter
//
// No production source files are modified on this branch. Two harness-
// only injections are used:
//
//   Run 3 (embedding soft-fail): the harness wraps `seams.computeEmbedding`
//   for ONE target candidate ID to return {ok: false, embedding_api_error}
//   directly. The Sentry capture for stage='embedding' lives upstream in
//   enrichmentJob.ts (lines 486-494, the if(!embeddingResult.ok) branch),
//   so returning {ok: false} is sufficient — the upstream capture fires
//   normally.
//
//   Run 4 (Redis fail-open): the harness wraps `attachEventSource` to
//   override deps.redis with a fresh ioredis client pointed at a closed
//   port (localhost:9). SET NX throws ECONNREFUSED → reenrichRateLimiter's
//   catch path fires (`console.warn` + return {allowed: false}) → reenrich
//   returns {ok: true, skipped: true} → attach completes cleanly. The real
//   Redis at port 6380 stays up so BullMQ keeps working — but Run 4 calls
//   processEnrichmentJob directly (not via BullMQ enqueue) so the wrapper
//   takes effect.
//
// Phases (single invocation walks all):
//   poll      — call processSourcePollJob for the 3 sources
//   run1      — boot worker, enqueue all candidates, drain
//   run2      — re-enqueue all, drain, verify zero work
//   cluster-analyze — count matches, similarity distribution, nearest miss
//   ratelimit-hp — rate limiter happy-path (re-attach with Redis up,
//                  expect skipped=true on second attach)
//   run3      — rewind one published candidate, inject embedding {ok:false}
//   run4      — rewind one cluster-matched candidate, inject broken redis,
//               direct-call processEnrichmentJob
//   cadence   — verify scheduleSourcePollRepeatable expectations
//   invariants — sample 5 published candidates for writeEvent invariants
//   teardown  — close worker, queue, redis, pg pool

import "dotenv/config";

import IORedis from "ioredis";
import { Worker, type Job } from "bullmq";
import { eq, sql, inArray, asc } from "drizzle-orm";

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
  type EnrichmentJobDeps,
} from "../jobs/ingestion/enrichmentJob";
import { runHeuristicSeam } from "../jobs/ingestion/heuristicSeam";
import { runRelevanceSeam } from "../jobs/ingestion/relevanceSeam";
import { runFactsSeam } from "../jobs/ingestion/factsSeam";
import { computeEmbedding as defaultComputeEmbedding } from "../jobs/ingestion/embeddingSeam";
import { attachEventSource as defaultAttachEventSource } from "../jobs/ingestion/attachEventSource";
import { writeEvent as defaultWriteEvent } from "../jobs/ingestion/writeEvent";
import { handleWorkerFailure } from "../jobs/ingestion/enrichmentWorkerFailure";
import { processSourcePollJob } from "../jobs/ingestion/sourcePollJob";
import { getOpenAIClient } from "../lib/openaiClient";

const TARGET_SOURCES = ["cnbc-markets", "import-ai", "semianalysis"];

// Holds the candidate ID for Run 3's embedding-soft-fail injection.
// Set just before Run 3 starts; null otherwise.
let RUN3_TARGET_CANDIDATE_ID: string | null = null;

function logSection(title: string): void {
  console.log("\n========================================");
  console.log("== " + title);
  console.log("========================================");
}

function logSnapshot(label: string, payload: unknown): void {
  console.log(`[smoke-snapshot] ${label}: ${JSON.stringify(payload)}`);
}

// ============================================================================
// Seams (Run-1/Run-2 worker config — production-equivalent + Run3 injection)
// ============================================================================

const baseSeams: EnrichmentSeams = {
  runHeuristic: (id) => runHeuristicSeam(id),
  runRelevanceGate: (id) => runRelevanceSeam(id),
  extractFacts: (id) => runFactsSeam(id),
  // computeEmbedding + checkCluster left as production defaults during
  // Run 1 / Run 2. Run 3 overrides computeEmbedding ad-hoc inside the
  // direct processEnrichmentJob call; the BullMQ worker construction
  // does NOT inject the wrapper because we want Run 1's traffic to use
  // the real OpenAI embedding seam.
};

// HARNESS WORKAROUND for issue #73 — writeEvent does not copy
// candidate.embedding to events.embedding. Without this copy, the
// 12e.6b cluster-match path is dead code (clusterCheckSeam.ts filters
// `WHERE embedding IS NOT NULL`). The harness wraps writeEvent to
// perform the copy post-insert so the rest of the smoke can validate
// cluster check + attach + priority promotion + re-enrichment against
// real data. Remove this wrapper once #73 is fixed in writeEvent.ts.
const wrappedWriteEvent: typeof defaultWriteEvent = async (
  candidateId,
  writeDeps,
) => {
  const result = await defaultWriteEvent(candidateId, writeDeps);
  // Copy candidate.embedding → events.embedding. Uses the same db
  // instance the writeEvent saw (defaults to module db).
  const inner = writeDeps?.db ?? db;
  const candRows = await inner
    .select({ embedding: ingestionCandidates.embedding })
    .from(ingestionCandidates)
    .where(eq(ingestionCandidates.id, candidateId))
    .limit(1);
  const embedding = candRows[0]?.embedding;
  if (embedding) {
    await inner
      .update(events)
      .set({ embedding })
      .where(eq(events.id, result.eventId));
  }
  return result;
};

// Embedding wrapper for Run 3 — returns {ok: false} for the target
// candidate ID, falls through to the production seam for any other.
const wrappedComputeEmbedding: typeof defaultComputeEmbedding = async (
  candidateId,
  deps,
) => {
  if (
    RUN3_TARGET_CANDIDATE_ID !== null &&
    candidateId === RUN3_TARGET_CANDIDATE_ID
  ) {
    console.log(
      `[smoke] Run 3 injection: returning {ok:false, embedding_api_error} for candidate=${candidateId}`,
    );
    return {
      ok: false,
      rejectionReason: "embedding_api_error",
      error: "smoke-injected: bypass OpenAI for target candidate",
    };
  }
  return defaultComputeEmbedding(candidateId, deps);
};

// ============================================================================
// BullMQ worker (Run 1 + Run 2)
// ============================================================================

async function bootWorker(): Promise<Worker<EnrichmentJobInput>> {
  if (!isRedisConfigured()) {
    throw new Error("Redis not configured — smoke requires REDIS_URL");
  }
  const connection = getRedis();
  if (!connection) throw new Error("getRedis() returned null");

  const worker = new Worker<EnrichmentJobInput>(
    ENRICHMENT_QUEUE_NAME,
    async (job: Job<EnrichmentJobInput>) => {
      const result = await processEnrichmentJob(
        { ...job.data, triggeredBy: job.data.triggeredBy ?? "poll" },
        { seams: baseSeams, writeEvent: wrappedWriteEvent },
      );
      const cm = result.clusterResult
        ? result.clusterResult.matched
          ? `cluster=matched=true,sim=${result.clusterResult.similarity.toFixed(4)},matchedEvent=${result.clusterResult.matchedEventId}`
          : `cluster=matched=false`
        : "cluster=absent";
      console.log(
        `[smoke-worker] candidate=${result.candidateId} terminal=${result.terminalStatus} event=${result.resolvedEventId ?? "none"} ${cm} promoted=${result.promoted ?? "n/a"} failure=${result.failureReason ?? "none"}`,
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
  console.log("[smoke] worker booted");
  return worker;
}

// ============================================================================
// Helpers
// ============================================================================

async function waitForDrain(label: string, timeoutMs = 25 * 60 * 1000): Promise<void> {
  const queue = getEnrichmentQueue();
  if (!queue) throw new Error("queue unavailable");
  const start = Date.now();
  let lastLog = 0;
  while (true) {
    const counts = await queue.getJobCounts("active", "waiting", "delayed");
    const remaining = counts.active + counts.waiting + counts.delayed;
    const now = Date.now();
    if (now - lastLog > 15_000) {
      console.log(
        `[smoke] [${label}] drain — active=${counts.active} waiting=${counts.waiting} delayed=${counts.delayed} elapsed=${Math.round((now - start) / 1000)}s`,
      );
      lastLog = now;
    }
    if (remaining === 0) {
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

interface StateSnapshot {
  candidatesByStatus: Record<string, number>;
  eventsCount: number;
  eventSourcesCount: number;
  candidatesWithEmbedding: number;
  candidatesWithoutEmbedding: number;
}

async function snapshotState(): Promise<StateSnapshot> {
  const byStatusRaw = await db
    .select({
      status: ingestionCandidates.status,
      count: sql<number>`count(*)::int`,
    })
    .from(ingestionCandidates)
    .groupBy(ingestionCandidates.status);
  const candidatesByStatus: Record<string, number> = {};
  for (const r of byStatusRaw) candidatesByStatus[r.status] = Number(r.count);
  const evC = await db.execute(sql`SELECT count(*)::int AS c FROM events`);
  const esC = await db.execute(
    sql`SELECT count(*)::int AS c FROM event_sources`,
  );
  const embWith = await db.execute(
    sql`SELECT count(*)::int AS c FROM ingestion_candidates WHERE embedding IS NOT NULL`,
  );
  const embWithout = await db.execute(
    sql`SELECT count(*)::int AS c FROM ingestion_candidates WHERE embedding IS NULL`,
  );
  return {
    candidatesByStatus,
    eventsCount: Number((evC.rows[0] as { c: number }).c),
    eventSourcesCount: Number((esC.rows[0] as { c: number }).c),
    candidatesWithEmbedding: Number((embWith.rows[0] as { c: number }).c),
    candidatesWithoutEmbedding: Number((embWithout.rows[0] as { c: number }).c),
  };
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

async function enqueueAll(ids: string[], label: string): Promise<void> {
  for (const id of ids) {
    await enqueueEnrichment({ candidateId: id, triggeredBy: "test" });
  }
  console.log(`[smoke] [${label}] enqueued ${ids.length} jobs`);
}

// ============================================================================
// Phase: poll
// ============================================================================

async function phasePoll(): Promise<{ totalDiscovered: number }> {
  logSection("PHASE: POLL");
  let total = 0;
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
    total += result.candidatesPersisted;
    logSnapshot(`poll.${slug}`, result);
  }
  logSnapshot("poll.total", { totalDiscovered: total });
  return { totalDiscovered: total };
}

// ============================================================================
// Phase: cluster analysis (count matches + similarity distribution)
// ============================================================================

interface ClusterMatchInfo {
  candidateId: string;
  resolvedEventId: string;
  similarity: number;
  isPromoted: boolean;
  // 'alternate' or 'primary' — the role this candidate's source row got
  myRole: "alternate" | "primary" | null;
}

async function phaseClusterAnalyze(): Promise<{
  matches: ClusterMatchInfo[];
  nearestMissTop5: number[];
}> {
  logSection("PHASE: CLUSTER MATCH ANALYSIS");

  // For every published candidate, compute its embedding's nearest neighbor
  // among PUBLISHED-via-writeEvent events (i.e., events whose primary source
  // came from a different candidate). If the nearest neighbor is the
  // candidate's OWN resolved_event_id, it's not a cross-candidate cluster
  // hit — skip those. We classify a "cluster match" as: candidate's
  // resolved_event_id was created BEFORE the candidate was processed
  // (resolved_event != self-event) AND there's an event_sources row for
  // that event with this candidate as a non-primary, OR the candidate's
  // event has multiple sources (one of which is this candidate).
  //
  // Simpler approach: count event_sources rows per event_id. Events with
  // ≥2 sources mean cluster matching attached additional sources after
  // the original write. Each non-primary row corresponds to a cluster match.
  const multiSource = await db.execute(
    sql`SELECT event_id, count(*)::int AS source_count FROM event_sources GROUP BY event_id HAVING count(*) > 1`,
  );

  const matches: ClusterMatchInfo[] = [];
  for (const row of multiSource.rows as Array<{
    event_id: string;
    source_count: number;
  }>) {
    // Get all event_sources for this event with their roles
    const sourcesForEvent = await db
      .select({
        id: eventSources.id,
        ingestionSourceId: eventSources.ingestionSourceId,
        role: eventSources.role,
      })
      .from(eventSources)
      .where(eq(eventSources.eventId, row.event_id));

    // Each candidate published to this event corresponds to either the
    // initial writeEvent (primary) or a subsequent attach (alternate or
    // promoted-to-primary). The discoveredAt order tells us which is which.
    // Sort candidates by published time (processedAt) ascending; first =
    // the writeEvent path, rest = attach paths.
    const candidatesWithTimes = await db
      .select({
        id: ingestionCandidates.id,
        sourceId: ingestionCandidates.ingestionSourceId,
        processedAt: ingestionCandidates.processedAt,
      })
      .from(ingestionCandidates)
      .where(eq(ingestionCandidates.resolvedEventId, row.event_id))
      .orderBy(asc(ingestionCandidates.processedAt));

    for (let i = 1; i < candidatesWithTimes.length; i++) {
      const cand = candidatesWithTimes[i];
      const myRow = sourcesForEvent.find(
        (s) => s.ingestionSourceId === cand.sourceId,
      );
      // similarity is logged at attach time but not persisted — recover
      // by re-computing cosine between the candidate's embedding and the
      // event's embedding.
      const simRaw = await db.execute(
        sql`SELECT 1 - (c.embedding <=> e.embedding) AS sim
            FROM ingestion_candidates c, events e
            WHERE c.id = ${cand.id} AND e.id = ${row.event_id}
              AND c.embedding IS NOT NULL AND e.embedding IS NOT NULL`,
      );
      const sim = Number(
        (simRaw.rows[0] as { sim: number } | undefined)?.sim ?? -1,
      );
      // Promotion: does the source's priority outrank the prior primary?
      // We can check by looking at all sources' priorities — the row with
      // role='primary' should be the highest-priority (lowest number) one
      // among those attached.
      const prio = await db.execute(
        sql`SELECT s.priority FROM ingestion_sources s WHERE s.id = ${cand.sourceId}`,
      );
      const myPriority = Number(
        (prio.rows[0] as { priority: number } | undefined)?.priority ?? 3,
      );
      // Find primary's source priority
      const primaryRow = sourcesForEvent.find((s) => s.role === "primary");
      let primaryPriority = 3;
      if (primaryRow?.ingestionSourceId) {
        const pp = await db.execute(
          sql`SELECT priority FROM ingestion_sources WHERE id = ${primaryRow.ingestionSourceId}`,
        );
        primaryPriority = Number(
          (pp.rows[0] as { priority: number } | undefined)?.priority ?? 3,
        );
      }
      const isPromoted = myRow?.role === "primary" && myPriority <= primaryPriority;

      matches.push({
        candidateId: cand.id,
        resolvedEventId: row.event_id,
        similarity: sim,
        isPromoted,
        myRole: (myRow?.role as "primary" | "alternate") ?? null,
      });
    }
  }

  for (const m of matches) {
    logSnapshot("cluster.match", m);
  }

  // Nearest-miss distribution: among published candidates that did NOT
  // cluster-match, what's the top-5 highest cosine similarity against
  // any other published event? Lets us know if threshold (0.85) was
  // close to firing.
  const nearestMiss = await db.execute(
    sql`
      WITH candidate_pairs AS (
        SELECT c.id AS candidate_id,
               1 - (c.embedding <=> e.embedding) AS sim,
               e.id AS event_id,
               c.resolved_event_id AS my_event_id
        FROM ingestion_candidates c
        CROSS JOIN events e
        WHERE c.embedding IS NOT NULL
          AND e.embedding IS NOT NULL
          AND c.status = 'published'
          AND e.id <> c.resolved_event_id
      )
      SELECT sim FROM candidate_pairs
      ORDER BY sim DESC
      LIMIT 5
    `,
  );
  const top5 = (nearestMiss.rows as Array<{ sim: number }>).map((r) =>
    Number(r.sim),
  );
  logSnapshot("cluster.nearest_miss_top5", top5);

  return { matches, nearestMissTop5: top5 };
}

// ============================================================================
// Phase: rate-limiter happy path
// Tests: re-attach a second time within the 1h window should skip re-enrich.
// ============================================================================

async function phaseRateLimiterHappyPath(
  match: ClusterMatchInfo,
): Promise<{ ok: boolean; secondAttachSkipped: boolean; ttlBefore: number; ttlAfter: number }> {
  logSection("PHASE: RATE-LIMITER HAPPY PATH");

  const redis = getRedis();
  if (!redis) {
    console.log("[smoke] no redis client — cannot verify rate limiter");
    return { ok: false, secondAttachSkipped: false, ttlBefore: -1, ttlAfter: -1 };
  }

  const key = `reenrich:rate:${match.resolvedEventId}`;
  const ttlBefore = await redis.ttl(key);
  console.log(`[smoke] reenrich rate key ttl BEFORE second attach: ${ttlBefore}s`);

  // Direct synchronous call to attachEventSource for a second time on
  // the same matched candidate. The rate limiter should return allowed=false
  // (key already exists with TTL ~3600s from the original Run 1 attach).
  const before = await db
    .select({
      facts: events.facts,
      whyItMatters: events.whyItMatters,
    })
    .from(events)
    .where(eq(events.id, match.resolvedEventId))
    .limit(1);
  const result = await defaultAttachEventSource(
    {
      candidateId: match.candidateId,
      matchedEventId: match.resolvedEventId,
      similarity: match.similarity,
    },
    { db, redis },
  );
  const after = await db
    .select({
      facts: events.facts,
      whyItMatters: events.whyItMatters,
    })
    .from(events)
    .where(eq(events.id, match.resolvedEventId))
    .limit(1);

  const ttlAfter = await redis.ttl(key);
  console.log(`[smoke] reenrich rate key ttl AFTER second attach: ${ttlAfter}s`);

  const reenrichRanAgain = JSON.stringify(before[0]?.whyItMatters) !== JSON.stringify(after[0]?.whyItMatters);

  logSnapshot("rate_limit_hp", {
    matchedEventId: match.resolvedEventId,
    attachOk: result.ok,
    ttlBefore,
    ttlAfter,
    reenrichRanAgain,
    note: "If TTL stayed positive and reenrich did not run again, the rate limiter blocked the second attempt as designed.",
  });
  return {
    ok: result.ok,
    secondAttachSkipped: !reenrichRanAgain,
    ttlBefore,
    ttlAfter,
  };
}

// ============================================================================
// Phase: Run 3 — embedding seam injection
// ============================================================================

async function phaseRun3(): Promise<{
  ranOrSkippedReason: string;
  candidateId: string | null;
  finalStatus: string | null;
  embeddingNullPostRun: boolean;
  clusterResultAbsent: boolean;
  beforeFacts: unknown;
  afterFacts: unknown;
}> {
  logSection("PHASE: RUN 3 — EMBEDDING SEAM INJECTION");

  // Pick a published candidate (any) and rewind it back to llm_relevant.
  const published = await db
    .select({ id: ingestionCandidates.id, resolvedEventId: ingestionCandidates.resolvedEventId })
    .from(ingestionCandidates)
    .where(eq(ingestionCandidates.status, "published"))
    .limit(5);
  const target = published[0];
  if (!target) {
    return {
      ranOrSkippedReason: "skipped — no published candidates to rewind",
      candidateId: null,
      finalStatus: null,
      embeddingNullPostRun: false,
      clusterResultAbsent: false,
      beforeFacts: null,
      afterFacts: null,
    };
  }
  RUN3_TARGET_CANDIDATE_ID = target.id;
  console.log(`[smoke] Run 3 target candidate=${target.id}`);

  // Snapshot facts before
  const candBefore = await db
    .select({
      facts: ingestionCandidates.facts,
      tierOutputs: ingestionCandidates.tierOutputs,
    })
    .from(ingestionCandidates)
    .where(eq(ingestionCandidates.id, target.id))
    .limit(1);

  // Rewind: clear embedding, facts, tier_outputs, resolved_event_id.
  // Status back to llm_relevant. Delete the event + event_sources so a
  // fresh writeEvent fires.
  await db
    .update(ingestionCandidates)
    .set({
      status: "llm_relevant",
      embedding: null,
      facts: null,
      factsExtractedAt: null,
      factsExtractionRaw: null,
      tierOutputs: null,
      tierGeneratedAt: null,
      tierOutputsRaw: null,
      resolvedEventId: null,
      processedAt: null,
    })
    .where(eq(ingestionCandidates.id, target.id));
  if (target.resolvedEventId) {
    await db
      .delete(eventSources)
      .where(eq(eventSources.eventId, target.resolvedEventId));
    await db.delete(events).where(eq(events.id, target.resolvedEventId));
  }
  console.log("[smoke] Run 3 candidate rewound to llm_relevant; embedding cleared");

  // DIRECT call (not via BullMQ) to processEnrichmentJob with the
  // wrapped seams (computeEmbedding override active for this candidate ID).
  const openai = getOpenAIClient();
  const result = await processEnrichmentJob(
    { candidateId: target.id, triggeredBy: "test" },
    {
      seams: {
        ...baseSeams,
        computeEmbedding: wrappedComputeEmbedding,
      },
      writeEvent: wrappedWriteEvent,
      openai,
    } satisfies EnrichmentJobDeps,
  );
  logSnapshot("run3.result", {
    terminalStatus: result.terminalStatus,
    resolvedEventId: result.resolvedEventId,
    failureReason: result.failureReason,
    clusterResult: result.clusterResult ?? null,
    promoted: result.promoted ?? null,
  });

  // Verify: candidate.embedding is NULL, candidate reaches published,
  // clusterResult absent.
  const post = await db
    .select({
      status: ingestionCandidates.status,
      embedding: sql<string | null>`embedding::text`,
      resolvedEventId: ingestionCandidates.resolvedEventId,
      facts: ingestionCandidates.facts,
    })
    .from(ingestionCandidates)
    .where(eq(ingestionCandidates.id, target.id))
    .limit(1);
  const postRow = post[0];

  return {
    ranOrSkippedReason: "ran",
    candidateId: target.id,
    finalStatus: postRow?.status ?? null,
    embeddingNullPostRun: postRow?.embedding === null,
    clusterResultAbsent: result.clusterResult === undefined,
    beforeFacts: candBefore[0]?.facts ?? null,
    afterFacts: postRow?.facts ?? null,
  };
}

// ============================================================================
// Phase: Run 4 — Redis fail-open injection
// ============================================================================

async function phaseRun4(
  match: ClusterMatchInfo,
): Promise<{
  ranOrSkippedReason: string;
  candidateId: string | null;
  attachCompleted: boolean;
  reenrichRan: boolean;
  candidateStatus: string | null;
}> {
  logSection("PHASE: RUN 4 — REDIS FAIL-OPEN INJECTION");

  // Use the cluster-matched candidate directly. Rewind it back to
  // llm_relevant with embedding cleared (so it re-embeds, re-clusters
  // against its own existing event, and dispatches to attach).
  const target = match.candidateId;
  console.log(`[smoke] Run 4 target candidate=${target} matched event=${match.resolvedEventId}`);

  // The rate-limiter HP phase already attached this candidate a second
  // time. Now we want a THIRD attach with broken redis. But the rate
  // limit key is still valid — even with broken redis, the cached key's
  // existence won't be checked because the SET will throw. The catch
  // path returns allowed=false → reenrich skipped → attach completes.
  // Either way, the expected behavior is: reenrich does not run, attach
  // completes, candidate stays published.

  // First, snapshot facts before
  const eventBefore = await db
    .select({
      facts: events.facts,
      whyItMatters: events.whyItMatters,
    })
    .from(events)
    .where(eq(events.id, match.resolvedEventId))
    .limit(1);

  // Build broken redis client pointed at a closed port. ioredis attempts
  // to connect on first command; SET will fail with ECONNREFUSED.
  const brokenRedis = new IORedis({
    host: "127.0.0.1",
    port: 9, // closed port — ECONNREFUSED on connect
    maxRetriesPerRequest: 0,
    enableOfflineQueue: false,
    lazyConnect: true,
    connectTimeout: 1000,
    retryStrategy: () => null, // do not retry
  });
  brokenRedis.on("error", () => {
    /* swallow; we want to observe the rate-limiter's catch path */
  });

  // Direct call attachEventSource with brokenRedis injected.
  const attachResult = await defaultAttachEventSource(
    {
      candidateId: target,
      matchedEventId: match.resolvedEventId,
      similarity: match.similarity,
    },
    { db, redis: brokenRedis },
  );
  await brokenRedis.quit().catch(() => undefined);

  const eventAfter = await db
    .select({
      facts: events.facts,
      whyItMatters: events.whyItMatters,
    })
    .from(events)
    .where(eq(events.id, match.resolvedEventId))
    .limit(1);
  const reenrichRan =
    JSON.stringify(eventBefore[0]?.whyItMatters) !==
    JSON.stringify(eventAfter[0]?.whyItMatters);

  const post = await db
    .select({ status: ingestionCandidates.status })
    .from(ingestionCandidates)
    .where(eq(ingestionCandidates.id, target))
    .limit(1);

  logSnapshot("run4.result", {
    attachOk: attachResult.ok,
    promoted: attachResult.ok ? attachResult.promoted : null,
    rejectionReason: attachResult.ok
      ? null
      : (attachResult as { rejectionReason: string }).rejectionReason,
    reenrichRan,
    candidateStatus: post[0]?.status ?? null,
  });

  return {
    ranOrSkippedReason: "ran",
    candidateId: target,
    attachCompleted: attachResult.ok,
    reenrichRan,
    candidateStatus: post[0]?.status ?? null,
  };
}

// ============================================================================
// Phase: cadence verification
// ============================================================================

async function phaseCadenceVerify(): Promise<unknown> {
  logSection("PHASE: CADENCE VERIFY");
  const sources = await db
    .select({
      slug: ingestionSources.slug,
      enabled: ingestionSources.enabled,
      fetchIntervalSeconds: ingestionSources.fetchIntervalSeconds,
      priority: ingestionSources.priority,
    })
    .from(ingestionSources)
    .where(inArray(ingestionSources.slug, TARGET_SOURCES));
  const expected = sources.map((s) => ({
    slug: s.slug,
    enabled: s.enabled,
    priority: s.priority,
    expectedEveryMs: s.fetchIntervalSeconds * 1000,
    expectedJobId: `repeat:poll:${s.slug}`,
  }));
  logSnapshot("cadence.expected", expected);
  return expected;
}

// ============================================================================
// Phase: writeEvent invariants — sample 5 published
// ============================================================================

async function phaseInvariants(): Promise<unknown> {
  logSection("PHASE: WRITE_EVENT INVARIANTS — SAMPLE 5");
  const rows = await db
    .select({
      candidateId: ingestionCandidates.id,
      resolvedEventId: ingestionCandidates.resolvedEventId,
      tierOutputs: ingestionCandidates.tierOutputs,
      rawTitle: ingestionCandidates.rawTitle,
      rawSummary: ingestionCandidates.rawSummary,
      rawPublishedAt: ingestionCandidates.rawPublishedAt,
      embedding: sql<string | null>`embedding::text`,
    })
    .from(ingestionCandidates)
    .where(eq(ingestionCandidates.status, "published"))
    .limit(10);
  const samples: unknown[] = [];
  for (const row of rows.slice(0, 5)) {
    if (!row.resolvedEventId) continue;
    const evRows = await db
      .select({
        id: events.id,
        whyItMatters: events.whyItMatters,
        whyItMattersTemplate: events.whyItMattersTemplate,
        publishedAt: events.publishedAt,
        embedding: sql<string | null>`embedding::text`,
      })
      .from(events)
      .where(eq(events.id, row.resolvedEventId))
      .limit(1);
    const ev = evRows[0];
    if (!ev) continue;
    samples.push({
      candidateId: row.candidateId,
      eventId: ev.id,
      whyItMattersStartsWith: (ev.whyItMatters ?? "").slice(0, 80),
      hasTemplate: ev.whyItMattersTemplate !== null,
      candidateEmbeddingPresent: row.embedding !== null,
      eventEmbeddingPresent: ev.embedding !== null,
      publishedAtMatch:
        (ev.publishedAt?.getTime() ?? -1) ===
        (row.rawPublishedAt?.getTime() ?? -1),
    });
  }
  for (const s of samples) logSnapshot("invariant.sample", s);
  return samples;
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  console.log("[smoke] Phase 12e.6 harness starting");
  const sentryEnabled = initSentry();
  console.log(`[smoke] Sentry init: ${sentryEnabled ? "enabled" : "disabled (no DSN)"}`);

  // ---- Phase: poll ----
  const pollResult = await phasePoll();
  if (pollResult.totalDiscovered === 0) {
    console.log("[smoke] STOP: 0 candidates discovered");
    process.exit(2);
  }

  const allIds = await getAllCandidateIds();
  console.log(`[smoke] discovered ${allIds.length} candidates total`);

  // ---- Boot worker for Run 1 + Run 2 ----
  const worker = await bootWorker();

  let run1Final: StateSnapshot | null = null;
  let run2Final: StateSnapshot | null = null;
  let clusterResults: { matches: ClusterMatchInfo[]; nearestMissTop5: number[] } = {
    matches: [],
    nearestMissTop5: [],
  };
  let rateLimitHpResult: unknown = "skipped";
  let run3Result: unknown = "skipped";
  let run4Result: unknown = "skipped";

  try {
    // ---- Run 1 ----
    logSection("PHASE: RUN 1 — HAPPY PATH");
    const beforeR1 = await snapshotState();
    logSnapshot("run1.before", beforeR1);
    const r1Start = Date.now();
    await enqueueAll(allIds, "run1");
    await waitForDrain("run1");
    const afterR1 = await snapshotState();
    logSnapshot("run1.after", afterR1);
    logSnapshot("run1.wallTimeMs", { ms: Date.now() - r1Start });
    run1Final = afterR1;

    // ---- Run 2 ----
    logSection("PHASE: RUN 2 — WHOLE-JOB SHORT-CIRCUIT");
    const beforeR2 = await snapshotState();
    logSnapshot("run2.before", beforeR2);
    // Capture per-candidate snapshot BEFORE Run 2 to verify the
    // whole-job short-circuit invariant (terminal candidates unchanged).
    const TERMINAL_PRE = new Set([
      "heuristic_filtered",
      "llm_rejected",
      "failed",
      "tier_generated",
      "published",
    ]);
    const preR2Rows = await db
      .select({
        id: ingestionCandidates.id,
        status: ingestionCandidates.status,
        resolvedEventId: ingestionCandidates.resolvedEventId,
        processedAt: ingestionCandidates.processedAt,
      })
      .from(ingestionCandidates);
    const preR2TerminalSnapshot: Record<
      string,
      { status: string; resolvedEventId: string | null; processedAt: number | null }
    > = {};
    for (const r of preR2Rows) {
      if (TERMINAL_PRE.has(r.status)) {
        preR2TerminalSnapshot[r.id] = {
          status: r.status,
          resolvedEventId: r.resolvedEventId ?? null,
          processedAt: r.processedAt?.getTime() ?? null,
        };
      }
    }
    const r2Start = Date.now();
    await enqueueAll(allIds, "run2");
    await waitForDrain("run2");
    const afterR2 = await snapshotState();
    logSnapshot("run2.after", afterR2);
    logSnapshot("run2.wallTimeMs", { ms: Date.now() - r2Start });
    run2Final = afterR2;

    // Run 2 invariant (soft form): candidates that were ALREADY in a
    // terminal state (heuristic_filtered, llm_rejected, failed,
    // tier_generated, published) at the start of Run 2 must remain
    // unchanged after Run 2. Non-terminal candidates (e.g. a stuck
    // `facts_extracted` from a tier-orchestration indeterminate
    // fall-through) MAY legitimately progress on re-enqueue per the
    // documented per-stage short-circuit behavior in enrichmentJob.ts.
    let drift = 0;
    const driftDetails: unknown[] = [];
    for (const id of Object.keys(preR2TerminalSnapshot)) {
      const post = await db
        .select({
          status: ingestionCandidates.status,
          resolvedEventId: ingestionCandidates.resolvedEventId,
          processedAt: ingestionCandidates.processedAt,
        })
        .from(ingestionCandidates)
        .where(eq(ingestionCandidates.id, id))
        .limit(1);
      const prev = preR2TerminalSnapshot[id];
      const cur = {
        status: post[0]?.status ?? "missing",
        resolvedEventId: post[0]?.resolvedEventId ?? null,
        processedAt: post[0]?.processedAt?.getTime() ?? null,
      };
      if (
        prev.status !== cur.status ||
        prev.resolvedEventId !== cur.resolvedEventId ||
        prev.processedAt !== cur.processedAt
      ) {
        drift++;
        driftDetails.push({ id, prev, cur });
      }
    }
    logSnapshot("run2.terminal_short_circuit_invariant", {
      pass: drift === 0,
      preTerminalCount: Object.keys(preR2TerminalSnapshot).length,
      drift,
      driftDetails: driftDetails.slice(0, 5),
      note:
        drift === 0
          ? "All candidates already at terminal state pre-R2 stayed unchanged. Whole-job short-circuit verified."
          : "Some terminal candidates moved during R2 — INVARIANT FAILURE",
    });
    // Also surface: did any non-terminal candidates progress in R2?
    // This is documented behavior, not a failure — record it in the
    // writeup as "Run 2 progressed N non-terminal residual candidates."
    const r2Progress = {
      preStatusCounts: beforeR2.candidatesByStatus,
      postStatusCounts: afterR2.candidatesByStatus,
      eventsDelta: afterR2.eventsCount - beforeR2.eventsCount,
      eventSourcesDelta:
        afterR2.eventSourcesCount - beforeR2.eventSourcesCount,
      note:
        "Non-terminal residue from Run 1 (e.g. facts_extracted from tier_orchestration_indeterminate) may legitimately progress in Run 2 via per-stage short-circuit + tier completion. Not a short-circuit failure.",
    };
    logSnapshot("run2.non_terminal_progression", r2Progress);

    // ---- Cluster analysis ----
    clusterResults = await phaseClusterAnalyze();
    const haveClusterMatch = clusterResults.matches.length > 0;
    logSnapshot("run1.clusterMatchCount", { count: clusterResults.matches.length });

    // ---- Rate-limiter happy path (conditional) ----
    if (haveClusterMatch) {
      const m = clusterResults.matches[0];
      rateLimitHpResult = await phaseRateLimiterHappyPath(m);
    } else {
      console.log("[smoke] rate-limiter HP skipped — no cluster match");
    }
  } finally {
    // Tear down BullMQ worker before Run 3 / Run 4 direct calls.
    console.log("[smoke] tearing down BullMQ worker");
    await worker.close().catch(() => undefined);
  }

  // ---- Run 3 (conditional) ----
  if (clusterResults.matches.length > 0) {
    run3Result = await phaseRun3();
  } else {
    console.log("[smoke] Run 3 skipped — zero cluster matches in Run 1");
  }

  // ---- Run 4 (conditional) ----
  if (clusterResults.matches.length > 0) {
    // Use a different match if available; if only one, reuse it (the
    // rate-limiter HP phase already used it).
    const m =
      clusterResults.matches.length > 1
        ? clusterResults.matches[1]
        : clusterResults.matches[0];
    run4Result = await phaseRun4(m);
  } else {
    console.log("[smoke] Run 4 skipped — zero cluster matches in Run 1");
  }

  // ---- Cadence verify ----
  await phaseCadenceVerify();

  // ---- Invariants ----
  await phaseInvariants();

  // ---- Final ----
  logSection("PHASE: FINAL");
  const finalSnap = await snapshotState();
  logSnapshot("final.state", finalSnap);
  logSnapshot("final.summary", {
    run1: run1Final,
    run2: run2Final,
    clusterMatchCount: clusterResults.matches.length,
    nearestMissTop5: clusterResults.nearestMissTop5,
    rateLimitHp: rateLimitHpResult,
    run3: run3Result,
    run4: run4Result,
  });

  // Cleanup
  await pool.end().catch(() => undefined);
  const queue = getEnrichmentQueue();
  if (queue) await queue.close().catch(() => undefined);
  const redis = getRedis();
  if (redis) await redis.quit().catch(() => undefined);

  console.log("[smoke] DONE");
}

main().catch((err) => {
  console.error("[smoke] FATAL:", err);
  process.exitCode = 1;
});
