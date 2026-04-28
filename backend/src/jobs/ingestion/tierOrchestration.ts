// Phase 12e.5b — tier-generation orchestration helpers, factored out of
// runIngestionEnrich.ts so they are testable without pulling in the
// heuristic seam's jsdom transitive (which Jest currently can't load
// cleanly — see docs/discovery/phase-12e5b-audit.md §10).
//
// Public surface:
//   - processTierGeneration(candidateId, deps?): runs the three tiers
//     in order, skipping any already present in tier_outputs. On full
//     success, advances status to 'tier_generated' and stamps
//     tier_generated_at. On any tier failure, leaves status at
//     'facts_extracted' with status_reason = the failed tier's
//     rejection class. Persistence is via jsonb_set on tier_outputs +
//     tier_outputs_raw, so per-tier idempotency is preserved across
//     retries.
//
// The split is purely a test-import hygiene boundary; runtime semantics
// are unchanged from the CLI's prior in-line implementation. 12e.5c
// will likely re-host this in the worker handle as part of chain
// orchestration.

import { eq, sql } from "drizzle-orm";

import { db as defaultDb } from "../../db";
import { ingestionCandidates } from "../../db/schema";
import {
  runTierGenerationSeam,
  type TierSeamResult,
} from "./tierGenerationSeam";
import type { TierName } from "../../services/haikuTierClient";

const TIER_ORDER: readonly TierName[] = ["accessible", "briefed", "technical"];

export interface TierProcessSummary {
  candidateId: string;
  ranTiers: TierName[];
  skippedTiers: TierName[];
  failedTier: { tier: TierName; reason: string } | null;
  completed: boolean;
}

export interface TierOrchestrationDeps {
  db?: typeof defaultDb;
  runTier?: typeof runTierGenerationSeam;
}

async function loadTierState(
  db: typeof defaultDb,
  candidateId: string,
): Promise<{
  status: string;
  tierOutputs: Record<string, unknown> | null;
} | null> {
  const rows = await db
    .select({
      status: ingestionCandidates.status,
      tierOutputs: ingestionCandidates.tierOutputs,
    })
    .from(ingestionCandidates)
    .where(eq(ingestionCandidates.id, candidateId))
    .limit(1);
  return (rows[0] as {
    status: string;
    tierOutputs: Record<string, unknown> | null;
  } | undefined) ?? null;
}

async function persistTierSuccess(
  db: typeof defaultDb,
  candidateId: string,
  tier: TierName,
  result: Extract<TierSeamResult, { ok: true }>,
): Promise<void> {
  const tierKey = tier;
  const outputJson = JSON.stringify(result.output);
  const rawJson = JSON.stringify(result.raw);
  // jsonb_set with create_missing=true on a NULL column requires
  // COALESCE to '{}'::jsonb first. Same pattern for tier_outputs_raw.
  await db.execute(sql`
    UPDATE ingestion_candidates
    SET
      tier_outputs = jsonb_set(
        COALESCE(tier_outputs, '{}'::jsonb),
        ARRAY[${tierKey}],
        ${outputJson}::jsonb,
        true
      ),
      tier_outputs_raw = jsonb_set(
        COALESCE(tier_outputs_raw, '{}'::jsonb),
        ARRAY[${tierKey}],
        ${rawJson}::jsonb,
        true
      ),
      processed_at = now()
    WHERE id = ${candidateId}
  `);
}

async function persistTierFailureRaw(
  db: typeof defaultDb,
  candidateId: string,
  tier: TierName,
  result: Extract<TierSeamResult, { ok: false }>,
): Promise<void> {
  if (!result.raw) return;
  const tierKey = tier;
  const rawJson = JSON.stringify(result.raw);
  await db.execute(sql`
    UPDATE ingestion_candidates
    SET
      tier_outputs_raw = jsonb_set(
        COALESCE(tier_outputs_raw, '{}'::jsonb),
        ARRAY[${tierKey}],
        ${rawJson}::jsonb,
        true
      ),
      processed_at = now()
    WHERE id = ${candidateId}
  `);
}

async function markTierGeneratedComplete(
  db: typeof defaultDb,
  candidateId: string,
): Promise<void> {
  await db
    .update(ingestionCandidates)
    .set({
      status: "tier_generated",
      tierGeneratedAt: new Date(),
      statusReason: null,
      processedAt: new Date(),
    })
    .where(eq(ingestionCandidates.id, candidateId));
}

async function markTierFailed(
  db: typeof defaultDb,
  candidateId: string,
  reason: string,
): Promise<void> {
  await db
    .update(ingestionCandidates)
    .set({
      // Stay at facts_extracted so the row remains selectable for
      // partial-state retry. status_reason captures the failed tier's
      // class for soak observability.
      status: "facts_extracted",
      statusReason: reason,
      processedAt: new Date(),
    })
    .where(eq(ingestionCandidates.id, candidateId));
}

export async function processTierGeneration(
  candidateId: string,
  deps: TierOrchestrationDeps = {},
): Promise<TierProcessSummary> {
  const db = deps.db ?? defaultDb;
  const runTier = deps.runTier ?? runTierGenerationSeam;

  const summary: TierProcessSummary = {
    candidateId,
    ranTiers: [],
    skippedTiers: [],
    failedTier: null,
    completed: false,
  };

  const initial = await loadTierState(db, candidateId);
  if (!initial) {
    return summary;
  }

  // Determine which tiers already exist. Skip those.
  const existingTiers = new Set<string>(
    initial.tierOutputs && typeof initial.tierOutputs === "object"
      ? Object.keys(initial.tierOutputs)
      : [],
  );

  for (const tier of TIER_ORDER) {
    if (existingTiers.has(tier)) {
      summary.skippedTiers.push(tier);
      continue;
    }
    const result = await runTier(candidateId, tier);
    summary.ranTiers.push(tier);
    if (result.ok) {
      await persistTierSuccess(db, candidateId, tier, result);
      existingTiers.add(tier);
    } else {
      await persistTierFailureRaw(db, candidateId, tier, result);
      summary.failedTier = { tier, reason: result.rejectionReason };
      // Stop on first failure — partial-state retry picks up missing
      // tiers on next invocation.
      break;
    }
  }

  if (summary.failedTier) {
    await markTierFailed(db, candidateId, summary.failedTier.reason);
    return summary;
  }

  // All three keys present → advance status.
  if (
    existingTiers.has("accessible") &&
    existingTiers.has("briefed") &&
    existingTiers.has("technical")
  ) {
    await markTierGeneratedComplete(db, candidateId);
    summary.completed = true;
  }

  return summary;
}
