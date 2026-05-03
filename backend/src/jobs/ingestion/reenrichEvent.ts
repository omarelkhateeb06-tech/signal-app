// Phase 12e.6c — re-enrichment orchestrator. Fires from
// attachEventSource after the attach transaction commits, when a
// candidate clusters onto an existing event. Rate-limited to one
// re-enrich per event per 1 hour via Redis SET NX.
//
// Flow:
//   1. checkAndSetReenrichRateLimit → if denied, return skipped=true
//   2. runFactsSeam(candidateId) → re-extracts facts from candidate body
//      (writes back to ingestion_candidates.facts)
//   3. Clear ingestion_candidates.tier_outputs + tier_generated_at —
//      forces processTierGeneration to actually regenerate (its per-tier
//      idempotency would otherwise skip because tiers were just completed
//      pre-attach). Cost: 3 Haiku calls per re-enrichment, capped at one
//      re-enrich per event per hour by the rate limiter.
//   4. processTierGeneration(candidateId) → re-runs all three tiers.
//   5. Re-load candidate facts + tier_outputs after the seams ran.
//   6. Compute new why_it_matters + why_it_matters_template via the
//      same helpers writeEvent uses (locked fallback chain + strict
//      template validation).
//   7. UPDATE events SET facts, why_it_matters, why_it_matters_template,
//      updated_at=now() WHERE id=eventId.
//
// Soft-fail at every stage. Sentry-captured with stage='reenrich' so the
// soak picks up systematic failures, but the attach (already committed
// by the caller) is never rolled back. Rate-limiter slot stays consumed
// even on failure — avoids retry storms within the hour window.

import { eq } from "drizzle-orm";
import type { Redis } from "ioredis";
import type OpenAI from "openai";

import { db as defaultDb } from "../../db";
import { events, ingestionCandidates } from "../../db/schema";
import { runFactsSeam } from "./factsSeam";
import { processTierGeneration } from "./tierOrchestration";
import {
  computeWhyItMatters,
  computeWhyItMattersTemplate,
  type CandidateRowForWrite,
} from "./writeEvent";
import { captureIngestionStageFailure } from "../../lib/sentryHelpers";
import { checkAndSetReenrichRateLimit } from "../../lib/reenrichRateLimiter";

export interface ReenrichEventInput {
  eventId: string;
  candidateId: string;
}

export type ReenrichFailureReason =
  | "reenrich_facts_failed"
  | "reenrich_tier_failed"
  | "reenrich_write_failed";

export type ReenrichEventResult =
  | { ok: true; skipped: boolean }
  | { ok: false; rejectionReason: ReenrichFailureReason; error?: unknown };

export interface ReenrichEventDeps {
  db?: typeof defaultDb;
  redis: Redis | null;
  openai?: OpenAI | null;
  // Test injection points — same seams as the main chain.
  runFacts?: typeof runFactsSeam;
  processTier?: typeof processTierGeneration;
  captureFailure?: typeof captureIngestionStageFailure;
  now?: () => Date;
}

interface CandidateRowForReenrich {
  rawTitle: string | null;
  bodyText: string | null;
  facts: Record<string, unknown> | null;
  tierOutputs: Record<string, unknown> | null;
}

async function loadCandidate(
  db: typeof defaultDb,
  candidateId: string,
): Promise<CandidateRowForReenrich | null> {
  const rows = await db
    .select({
      rawTitle: ingestionCandidates.rawTitle,
      bodyText: ingestionCandidates.bodyText,
      facts: ingestionCandidates.facts,
      tierOutputs: ingestionCandidates.tierOutputs,
    })
    .from(ingestionCandidates)
    .where(eq(ingestionCandidates.id, candidateId))
    .limit(1);
  return (rows[0] as CandidateRowForReenrich | undefined) ?? null;
}

export async function reenrichEvent(
  input: ReenrichEventInput,
  deps: ReenrichEventDeps,
): Promise<ReenrichEventResult> {
  const db = deps.db ?? defaultDb;
  const captureFailure = deps.captureFailure ?? captureIngestionStageFailure;
  const runFacts = deps.runFacts ?? runFactsSeam;
  const processTier = deps.processTier ?? processTierGeneration;
  const now = deps.now ?? ((): Date => new Date());

  const limit = await checkAndSetReenrichRateLimit(input.eventId, {
    redis: deps.redis,
  });
  if (!limit.allowed) {
    return { ok: true, skipped: true };
  }

  // Step 1: re-run facts extraction. runFactsSeam re-calls Haiku and
  // writes the result back to ingestion_candidates.facts. The Haiku cost
  // is bounded by the rate limiter (one call per event per hour).
  const factsResult = await runFacts(input.candidateId);
  if (!factsResult.ok) {
    captureFailure({
      stage: "reenrich",
      candidateId: input.candidateId,
      sourceSlug: null,
      rejectionReason: `reenrich_facts_failed:${factsResult.rejectionReason ?? "unknown"}`,
    });
    return { ok: false, rejectionReason: "reenrich_facts_failed" };
  }

  // Step 2: force tier re-generation. Clear existing tier_outputs so the
  // per-tier idempotency check in processTierGeneration doesn't short-
  // circuit. Without this, tiers are always skipped at re-enrichment time
  // because the candidate completed tiers before reaching the attach
  // dispatch — and the locked re-enrichment policy is "regenerate from
  // the new source's content", not "refresh facts only". A failure on
  // this UPDATE routes to reenrich_tier_failed (same path as a downstream
  // tier failure — the rate-limiter slot is already consumed).
  try {
    await db
      .update(ingestionCandidates)
      .set({ tierOutputs: null, tierGeneratedAt: null })
      .where(eq(ingestionCandidates.id, input.candidateId));
  } catch (err) {
    captureFailure({
      stage: "reenrich",
      candidateId: input.candidateId,
      sourceSlug: null,
      rejectionReason: "reenrich_tier_failed:tier_outputs_clear_failed",
      err,
    });
    return { ok: false, rejectionReason: "reenrich_tier_failed", error: err };
  }

  const tierSummary = await processTier(input.candidateId, { db });
  if (tierSummary.failedTier) {
    captureFailure({
      stage: "reenrich",
      candidateId: input.candidateId,
      sourceSlug: null,
      rejectionReason: `reenrich_tier_failed:${tierSummary.failedTier.tier}:${tierSummary.failedTier.reason}`,
    });
    return { ok: false, rejectionReason: "reenrich_tier_failed" };
  }

  // Re-load candidate to pick up the just-written facts (and any tier
  // updates if processTier wasn't a pure no-op).
  const refreshed = await loadCandidate(db, input.candidateId);
  if (!refreshed) {
    captureFailure({
      stage: "reenrich",
      candidateId: input.candidateId,
      sourceSlug: null,
      rejectionReason: "reenrich_write_failed:candidate_disappeared",
    });
    return { ok: false, rejectionReason: "reenrich_write_failed" };
  }

  // NOTE: writeEvent is NOT re-run. The event row already exists. Only
  // facts, why_it_matters, why_it_matters_template, updated_at are
  // updated here. event_sources rows are managed by attachEventSource
  // (12e.6b), not here.
  //
  // Construct a minimal CandidateRowForWrite-compatible shape so the
  // exported helpers from writeEvent.ts produce the same fallback chain
  // and template validation as the new-event write path.
  const candidateForWrite: CandidateRowForWrite = {
    id: input.candidateId,
    ingestionSourceId: "",
    url: "",
    rawTitle: refreshed.rawTitle,
    rawSummary: null,
    rawPublishedAt: null,
    bodyText: refreshed.bodyText,
    sector: null,
    facts: refreshed.facts,
    tierOutputs: refreshed.tierOutputs,
    embedding: null,
    sourceDisplayName: "",
    sourcePairedWriterId: null,
  };

  let whyItMatters: string;
  let whyItMattersTemplate: string;
  try {
    whyItMatters = computeWhyItMatters(candidateForWrite);
    whyItMattersTemplate = computeWhyItMattersTemplate(candidateForWrite);
  } catch (err) {
    captureFailure({
      stage: "reenrich",
      candidateId: input.candidateId,
      sourceSlug: null,
      rejectionReason: "reenrich_write_failed:template_assertion",
      err,
    });
    return { ok: false, rejectionReason: "reenrich_write_failed", error: err };
  }

  try {
    await db
      .update(events)
      .set({
        facts: refreshed.facts ?? {},
        whyItMatters,
        whyItMattersTemplate,
        updatedAt: now(),
      })
      .where(eq(events.id, input.eventId));
  } catch (err) {
    captureFailure({
      stage: "reenrich",
      candidateId: input.candidateId,
      sourceSlug: null,
      rejectionReason: "reenrich_write_failed:db_error",
      err,
    });
    return { ok: false, rejectionReason: "reenrich_write_failed", error: err };
  }

  // eslint-disable-next-line no-console
  console.log(
    `[ingestion-reenrich] event=${input.eventId} candidate=${input.candidateId} updated`,
  );
  return { ok: true, skipped: false };
}
