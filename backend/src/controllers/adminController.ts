import type { NextFunction, Request, Response } from "express";
import type { Queue } from "bullmq";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "../db";
import {
  events,
  eventSources,
  ingestionSources,
  ingestionCandidates,
} from "../db/schema";
import { getEnrichmentQueue } from "../jobs/ingestion/enrichmentQueue";
import { getSourcePollQueue } from "../jobs/ingestion/sourcePollQueue";

// Phase 12e.8 — read-only admin status endpoint.
// Returns a snapshot of the ingestion pipeline health:
//   - per-source: last_success_at, consecutive_failure_count,
//     rejection_rate_24h, 24h ingest counts
//   - queue depths for enrichment + source-poll queues
//   - last 50 failed candidates
//   - 24h cluster statistics (events created vs sources attached)
//
// Read-only by design — the caller's role is observability, not
// remediation. Source-level kill-switch decisions stay manual until a
// future phase formalizes them.

const RECENT_FAILURES_LIMIT = 50;
const REJECTION_RATE_MIN_SAMPLE = 50;

interface QueueDepths {
  waiting: number;
  active: number;
  failed: number;
}

// When the queue getter returns null (REDIS_URL unset), the entire
// ingestion pipeline is offline; surface zeros rather than 500ing on
// the admin route — the per-source columns + recent_failures still
// reflect last-known DB state and remain useful even mid-outage.
async function readQueueDepths<T>(
  queue: Queue<T> | null,
): Promise<QueueDepths> {
  if (!queue) return { waiting: 0, active: 0, failed: 0 };
  const [waiting, active, failed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getFailedCount(),
  ]);
  return { waiting, active, failed };
}

export async function getIngestionStatus(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // --- Per-source metadata ---
    const sources = await db
      .select({
        id: ingestionSources.id,
        slug: ingestionSources.slug,
        displayName: ingestionSources.displayName,
        adapterType: ingestionSources.adapterType,
        enabled: ingestionSources.enabled,
        lastPolledAt: ingestionSources.lastPolledAt,
        lastSuccessAt: ingestionSources.lastSuccessAt,
        consecutiveFailureCount: ingestionSources.consecutiveFailureCount,
      })
      .from(ingestionSources)
      .orderBy(ingestionSources.slug);

    // --- 24h candidate counts per source (total + rejected + published) ---
    // Rejected = anything that didn't reach `published`, including
    // heuristic_filtered, llm_rejected, failed. The rate is null when
    // sample < REJECTION_RATE_MIN_SAMPLE — small denominators are noisy
    // and the kill-switch threshold (per roadmap §5.4) is also gated on
    // a 50+ sample.
    const candidateCounts = await db
      .select({
        ingestionSourceId: ingestionCandidates.ingestionSourceId,
        total: sql<number>`COUNT(*)::int`,
        rejected: sql<number>`COUNT(*) FILTER (WHERE status IN ('heuristic_filtered','llm_rejected','failed'))::int`,
        published: sql<number>`COUNT(*) FILTER (WHERE status = 'published')::int`,
      })
      .from(ingestionCandidates)
      .where(gte(ingestionCandidates.discoveredAt, since24h))
      .groupBy(ingestionCandidates.ingestionSourceId);

    const countsBySource = new Map(
      candidateCounts.map((r) => [r.ingestionSourceId, r]),
    );

    const sourcesPayload = sources.map((s) => {
      const counts = countsBySource.get(s.id);
      const total = Number(counts?.total ?? 0);
      const rejected = Number(counts?.rejected ?? 0);
      const published = Number(counts?.published ?? 0);
      const rejectionRate24h =
        total >= REJECTION_RATE_MIN_SAMPLE
          ? Math.round((rejected / total) * 100) / 100
          : null;
      return {
        id: s.id,
        slug: s.slug,
        display_name: s.displayName,
        adapter_type: s.adapterType,
        enabled: s.enabled,
        last_polled_at: s.lastPolledAt,
        last_success_at: s.lastSuccessAt,
        consecutive_failure_count: s.consecutiveFailureCount,
        candidates_24h: total,
        published_24h: published,
        rejected_24h: rejected,
        rejection_rate_24h: rejectionRate24h,
      };
    });

    // --- Queue depths ---
    const enrichmentQueue = getEnrichmentQueue();
    const sourcePollQueue = getSourcePollQueue();
    const [enrichment, sourcePoll] = await Promise.all([
      readQueueDepths(enrichmentQueue),
      readQueueDepths(sourcePollQueue),
    ]);

    // --- Recent failures (last 50) ---
    // 'failed' is the explicit dead-letter status from the chain
    // orchestrator. heuristic_filtered / llm_rejected are normal
    // attrition and intentionally omitted from this view — they'd
    // drown the signal.
    const recentFailures = await db
      .select({
        id: ingestionCandidates.id,
        ingestionSourceId: ingestionCandidates.ingestionSourceId,
        url: ingestionCandidates.url,
        status: ingestionCandidates.status,
        statusReason: ingestionCandidates.statusReason,
        discoveredAt: ingestionCandidates.discoveredAt,
        processedAt: ingestionCandidates.processedAt,
      })
      .from(ingestionCandidates)
      .where(eq(ingestionCandidates.status, "failed"))
      .orderBy(desc(ingestionCandidates.processedAt))
      .limit(RECENT_FAILURES_LIMIT);

    // --- 24h cluster statistics ---
    // events_created: new event rows in the window (each one represents
    // a new-event write path).
    // sources_attached: alternate event_sources rows joined to existing
    // events in the window (each one represents a cluster-match attach).
    const [eventsCreatedRow] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(events)
      .where(gte(events.createdAt, since24h));
    const [sourcesAttachedRow] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(eventSources)
      .where(
        and(
          eq(eventSources.role, "alternate"),
          gte(eventSources.createdAt, since24h),
        ),
      );
    const eventsCreated = Number(eventsCreatedRow?.count ?? 0);
    const sourcesAttached = Number(sourcesAttachedRow?.count ?? 0);

    res.json({
      data: {
        as_of: new Date(),
        sources: sourcesPayload,
        queues: {
          enrichment,
          source_poll: sourcePoll,
        },
        recent_failures: recentFailures.map((f) => ({
          id: f.id,
          source_id: f.ingestionSourceId,
          url: f.url,
          status: f.status,
          reason: f.statusReason,
          discovered_at: f.discoveredAt,
          processed_at: f.processedAt,
        })),
        cluster_stats_24h: {
          events_created: eventsCreated,
          sources_attached: sourcesAttached,
        },
      },
    });
  } catch (error) {
    next(error);
  }
}
