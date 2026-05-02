// Pure job body for the enrichment stage — Redis-free, CLI-runnable.
// Consumes one ingestion_candidates row and runs it through the four-
// stage pipeline:
//
//   1. heuristic gate (12e.3)
//   2. relevance gate (12e.4)
//   3. fact extraction (12e.5a)
//   4. tier generation × 3 — accessible / briefed / technical (12e.5b)
//      ← 12e.5b ADDS the seam definitions; 12e.5c owns wiring into
//        the orchestration body alongside dead-letter handling.
//   5. write to events + event_sources OR cluster onto an existing
//      event (12e.6b)
//
// 12e.3 wired the heuristic seam fully. 12e.4 wired the LLM relevance
// gate. 12e.5a wired the fact-extraction seam. 12e.5b adds the tier-
// generation seams (one seam per tier, parameterized) but does NOT
// wire them into the orchestration body — that lands in 12e.5c, which
// also owns the cluster + write-event chain and the dead-letter
// handling for stage failures across all four enrichment stages.

import { eq } from "drizzle-orm";

import { db as defaultDb } from "../../db";
import { ingestionCandidates } from "../../db/schema";
import { HEURISTIC_REASONS, type HeuristicReason } from "./heuristics";
import type { RelevanceReason, RelevanceSeamRaw, Sector } from "./relevanceSeam";
import type { FactsSeamResult } from "./factsSeam";
import type { TierSeamResult } from "./tierGenerationSeam";
import { processTierGeneration } from "./tierOrchestration";

export interface EnrichmentJobInput {
  candidateId: string;
  triggeredBy?: "poll" | "cli" | "test";
}

export interface EnrichmentJobResult {
  candidateId: string;
  // Set when the candidate produced a new event.
  resolvedEventId: string | null;
  // Reflects the terminal state we wrote back to
  // ingestion_candidates.status. `heuristic_passed` is non-terminal
  // post-12e.4, but is the terminal state for this stage as long as
  // 12e.4 hasn't shipped — once relevance gate is wired, the orchestration
  // continues past heuristic_passed to llm_rejected / enriching / …
  terminalStatus:
    | "heuristic_filtered"
    | "heuristic_passed"
    | "llm_rejected"
    | "llm_relevant"
    | "facts_extracted"
    | "tier_generated"
    | "published"
    | "duplicate"
    | "failed";
  failureReason: string | null;
}

// Seam interface — each method is filled in by a downstream sub-session.
// 12e.3 fills runHeuristic; 12e.4 fills runRelevanceGate; 12e.5a fills
// extractFacts; 12e.5b fills generateTier; 12e.6a fills resolveCluster.
// `body` on the runHeuristic return shape is the readability-extracted
// plain text plus a flag indicating whether it was truncated at the
// 200 KB cap. Truncation does not reject the candidate.
export interface EnrichmentSeams {
  runHeuristic?: (candidateId: string) => Promise<{
    pass: boolean;
    reason?: HeuristicReason;
    body?: { text: string; truncated: boolean };
  }>;
  runRelevanceGate?: (
    candidateId: string,
  ) => Promise<{
    relevant: boolean;
    sector?: Sector;
    reason?: string;
    rejectionReason?: RelevanceReason;
    raw?: RelevanceSeamRaw;
  }>;
  extractFacts?: (candidateId: string) => Promise<FactsSeamResult>;
  // 12e.5b: seam loads candidate (facts + body + title + sector)
  // internally per the 12e.5b stage 1 audit §8 recommendation. The
  // orchestration owns per-tier presence checks against
  // `tier_outputs->>'<tier>'` before invoking — the seam itself does
  // not short-circuit on already-completed tiers. Wiring into
  // `enrichmentWorker.handle()` is 12e.5c's responsibility.
  generateTier?: (
    candidateId: string,
    tier: "accessible" | "briefed" | "technical",
  ) => Promise<TierSeamResult>;
  resolveCluster?: (
    candidateId: string,
  ) => Promise<{ eventId: string | null; similarity: number }>;
}

export interface EnrichmentJobDeps {
  db?: typeof defaultDb;
  seams?: EnrichmentSeams;
  // Optional override for the tier-generation orchestration call (12e.5c
  // sub-step 2). Defaults to `processTierGeneration` from
  // tierOrchestration.ts. Tests inject a mock to avoid threading the
  // full per-tier mockDb queue setup that the orchestrator's internal
  // loadTierState + jsonb_set executes would otherwise require.
  processTier?: typeof processTierGeneration;
}

// Statuses at which the chain has terminated and re-processing would
// either waste work (terminal-success) or destroy state (terminal-
// rejection — re-running heuristic would overwrite the reason and
// orphan the rejection). The whole-job short-circuit at the top of
// `processEnrichmentJob` returns immediately for any candidate already
// at one of these states.
const TERMINAL_STATES: ReadonlySet<string> = new Set([
  // Terminal-rejection
  "heuristic_filtered",
  "llm_rejected",
  "failed",
  // Terminal-success
  "tier_generated",
  "published",
]);

// Subset of TERMINAL_STATES used to decide whether the result envelope's
// `failureReason` should carry the persisted `status_reason` (rejection)
// or be null (success).
const TERMINAL_REJECTIONS: ReadonlySet<string> = new Set([
  "heuristic_filtered",
  "llm_rejected",
  "failed",
]);

// Statuses that imply the relevance gate has produced a verdict (whether
// rejection or pass). Used by the per-stage short-circuit before
// `runRelevanceGate` to detect that relevance has run in a prior job
// invocation, even if this invocation's heuristic just transiently
// overwrote `status` to 'heuristic_passed'. Includes 'tier_generated'
// and 'published' for completeness, though the whole-job short-circuit
// catches those upstream.
const PAST_HEURISTIC_PASSED: ReadonlySet<string> = new Set([
  "llm_rejected",
  "llm_relevant",
  "facts_extracted",
  "tier_generated",
  "enriching",
  "published",
]);

interface CandidateSnapshot {
  status: string;
  statusReason: string | null;
  llmJudgmentRaw: Record<string, unknown> | null;
  factsExtractedAt: Date | null;
  tierOutputs: Record<string, unknown> | null;
  resolvedEventId: string | null;
}

// Read persisted candidate state once at the top of `processEnrichmentJob`.
// Used by both the whole-job short-circuit (terminal-state guard) and
// the per-stage short-circuits (skip relevance/facts seam calls when
// their outputs are already persisted). Snapshot reflects state BEFORE
// any seam in this invocation runs — this is load-bearing for the
// per-stage short-circuits to read llm_judgment_raw / facts_extracted_at
// from the correct vintage even after `runHeuristic` transiently
// overwrites `status` to 'heuristic_passed'.
async function loadCandidateSnapshot(
  db: typeof defaultDb,
  candidateId: string,
): Promise<CandidateSnapshot | null> {
  const rows = await db
    .select({
      status: ingestionCandidates.status,
      statusReason: ingestionCandidates.statusReason,
      llmJudgmentRaw: ingestionCandidates.llmJudgmentRaw,
      factsExtractedAt: ingestionCandidates.factsExtractedAt,
      tierOutputs: ingestionCandidates.tierOutputs,
      resolvedEventId: ingestionCandidates.resolvedEventId,
    })
    .from(ingestionCandidates)
    .where(eq(ingestionCandidates.id, candidateId))
    .limit(1);
  return (rows[0] as CandidateSnapshot | undefined) ?? null;
}

export async function processEnrichmentJob(
  input: EnrichmentJobInput,
  deps: EnrichmentJobDeps = {},
): Promise<EnrichmentJobResult> {
  const db = deps.db ?? defaultDb;
  const seams = deps.seams ?? {};

  if (!seams.runHeuristic) {
    return {
      candidateId: input.candidateId,
      resolvedEventId: null,
      terminalStatus: "failed",
      failureReason: "runHeuristic seam not provided",
    };
  }

  // Whole-job short-circuit (12e.5c sub-step 1).
  // Closes two correctness gaps that would otherwise fire on a BullMQ
  // retry of an already-progressed candidate:
  //   (1) LLM-double-charge — re-firing relevance/facts/tier seams.
  //   (2) heuristic-overwrite data loss — re-running heuristic would
  //       overwrite `status` (e.g., reverting 'llm_rejected' to
  //       'heuristic_passed' or 'heuristic_filtered'), orphaning the
  //       persisted rejection reason / facts / tier_outputs.
  // Snapshot is also reused below by the per-stage short-circuits.
  const snapshot = await loadCandidateSnapshot(db, input.candidateId);

  if (snapshot && TERMINAL_STATES.has(snapshot.status)) {
    return {
      candidateId: input.candidateId,
      resolvedEventId: snapshot.resolvedEventId,
      terminalStatus: snapshot.status as EnrichmentJobResult["terminalStatus"],
      failureReason: TERMINAL_REJECTIONS.has(snapshot.status)
        ? snapshot.statusReason ?? "unknown"
        : null,
    };
  }

  const result = await seams.runHeuristic(input.candidateId);

  if (!result.pass) {
    await db
      .update(ingestionCandidates)
      .set({
        status: "heuristic_filtered",
        statusReason: result.reason ?? "unknown",
        processedAt: new Date(),
      })
      .where(eq(ingestionCandidates.id, input.candidateId));
    return {
      candidateId: input.candidateId,
      resolvedEventId: null,
      terminalStatus: "heuristic_filtered",
      failureReason: result.reason ?? "unknown",
    };
  }

  // Pass — persist body if present, advance status. Truncation is
  // recorded informationally in status_reason but the candidate still
  // moves forward (status='heuristic_passed').
  const updates: {
    status: "heuristic_passed";
    processedAt: Date;
    bodyText?: string;
    statusReason?: string;
  } = {
    status: "heuristic_passed",
    processedAt: new Date(),
  };
  if (result.body) {
    updates.bodyText = result.body.text;
    if (result.body.truncated) {
      updates.statusReason = HEURISTIC_REASONS.BODY_TRUNCATED;
    }
  }
  await db
    .update(ingestionCandidates)
    .set(updates)
    .where(eq(ingestionCandidates.id, input.candidateId));

  // ---- Relevance gate (12e.4) ----
  // Per-stage short-circuit (12e.5c sub-step 1): skip if a prior job
  // already wrote llm_judgment_raw and advanced status past
  // heuristic_passed. Snapshot reflects pre-invocation state, so the
  // transient 'heuristic_passed' that THIS job's runHeuristic just
  // wrote does not break the predicate. The whole-job short-circuit
  // upstream already returned for 'llm_rejected'; here we only need
  // to handle the pass case (skip relevance, fall through to facts).
  const relevanceAlreadyRan =
    snapshot !== null &&
    snapshot.llmJudgmentRaw !== null &&
    PAST_HEURISTIC_PASSED.has(snapshot.status);

  if (!relevanceAlreadyRan) {
    // If runRelevanceGate is wired, continue past heuristic_passed.
    // If not, terminate at heuristic_passed (preserves the 12e.3
    // CLI-without-LLM behavior; opt-in for tests + future workers).
    if (!seams.runRelevanceGate) {
      return {
        candidateId: input.candidateId,
        resolvedEventId: null,
        terminalStatus: "heuristic_passed",
        failureReason: null,
      };
    }

    const relevance = await seams.runRelevanceGate(input.candidateId);

    // Always persist llm_judgment_raw when a successful Haiku call
    // produced one (raw is set when at least one attempt returned text;
    // unset on hard client-level failures like no_api_key / timeout).
    // processedAt advances on every relevance-gate completion regardless
    // of verdict.
    const relevanceUpdates: {
      processedAt: Date;
      status?: "llm_relevant" | "llm_rejected";
      statusReason?: string;
      sector?: string | null;
      llmJudgmentRaw?: Record<string, unknown> | null;
    } = {
      processedAt: new Date(),
    };
    if (relevance.raw) {
      // Cast: the seam's RelevanceSeamRaw is structurally a JSON-safe
      // record. The schema column is jsonb<Record<string, unknown>>.
      relevanceUpdates.llmJudgmentRaw = relevance.raw as unknown as Record<
        string,
        unknown
      >;
    }

    if (!relevance.relevant) {
      relevanceUpdates.status = "llm_rejected";
      relevanceUpdates.statusReason =
        relevance.rejectionReason ?? "llm_rejected";
      // sector stays NULL on rejection (G5 — even if the LLM offered
      // one, it's not actionable for a rejected candidate).
      await db
        .update(ingestionCandidates)
        .set(relevanceUpdates)
        .where(eq(ingestionCandidates.id, input.candidateId));
      return {
        candidateId: input.candidateId,
        resolvedEventId: null,
        terminalStatus: "llm_rejected",
        failureReason: relevance.rejectionReason ?? "llm_rejected",
      };
    }

    // Pass — sector populated, status advances to llm_relevant.
    relevanceUpdates.status = "llm_relevant";
    relevanceUpdates.sector = relevance.sector ?? null;
    await db
      .update(ingestionCandidates)
      .set(relevanceUpdates)
      .where(eq(ingestionCandidates.id, input.candidateId));
  }

  // ---- Fact extraction (12e.5a) ----
  // Per-stage short-circuit (12e.5c sub-step 1): skip if a prior job
  // already stamped facts_extracted_at. Snapshot's facts_extracted_at
  // is read against pre-invocation state for the same reason as the
  // relevance check above.
  const factsAlreadyRan =
    snapshot !== null && snapshot.factsExtractedAt !== null;

  if (!factsAlreadyRan) {
    // If extractFacts is wired, continue past llm_relevant. If not,
    // terminate at llm_relevant (preserves the 12e.4 behavior; opt-in
    // for tests + future workers via seam injection).
    if (!seams.extractFacts) {
      return {
        candidateId: input.candidateId,
        resolvedEventId: null,
        terminalStatus: "llm_relevant",
        failureReason: null,
      };
    }

    const facts = await seams.extractFacts(input.candidateId);

    // Persist facts_extraction_raw whenever a successful Haiku call
    // produced one (raw is set when at least one attempt returned text;
    // unset on hard client-level failures like no_api_key / timeout).
    // processedAt advances on every facts-stage completion regardless of
    // verdict.
    const factsUpdates: {
      processedAt: Date;
      status?: "facts_extracted" | "failed";
      statusReason?: string;
      facts?: Record<string, unknown> | null;
      factsExtractedAt?: Date | null;
      factsExtractionRaw?: Record<string, unknown> | null;
    } = {
      processedAt: new Date(),
    };
    if (facts.raw) {
      factsUpdates.factsExtractionRaw = facts.raw as unknown as Record<
        string,
        unknown
      >;
    }

    if (!facts.ok) {
      factsUpdates.status = "failed";
      factsUpdates.statusReason =
        facts.rejectionReason ?? "facts_parse_error";
      await db
        .update(ingestionCandidates)
        .set(factsUpdates)
        .where(eq(ingestionCandidates.id, input.candidateId));
      return {
        candidateId: input.candidateId,
        resolvedEventId: null,
        terminalStatus: "failed",
        failureReason: facts.rejectionReason ?? "facts_parse_error",
      };
    }

    // Pass — facts populated, status advances to facts_extracted,
    // facts_extracted_at stamped now.
    factsUpdates.status = "facts_extracted";
    factsUpdates.facts = facts.facts as unknown as Record<string, unknown>;
    factsUpdates.factsExtractedAt = new Date();
    await db
      .update(ingestionCandidates)
      .set(factsUpdates)
      .where(eq(ingestionCandidates.id, input.candidateId));
  }

  // ---- Tier generation (12e.5b orchestration; wired into the chain
  // by 12e.5c sub-step 2) ----
  // Per-tier idempotency lives inside processTierGeneration (see
  // tierOrchestration.ts:181-198 — checks `tier_outputs->>'<tier>'`
  // against the persisted JSONB column before invoking each tier).
  // The whole-job short-circuit upstream already returned for any
  // candidate at status='tier_generated', so by this point the
  // candidate is at facts_extracted (or transient earlier states this
  // invocation just walked through). The orchestrator owns its own DB
  // writes (jsonb_set + status advance to 'tier_generated' on full-trio
  // completion).
  const runTier = deps.processTier ?? processTierGeneration;
  const tierSummary = await runTier(input.candidateId, { db });

  if (tierSummary.failedTier) {
    // markTierFailed has already written status='facts_extracted' with
    // status_reason set to the failed tier's class. Surface the failure
    // class in the result envelope.
    return {
      candidateId: input.candidateId,
      resolvedEventId: null,
      terminalStatus: "failed",
      failureReason: tierSummary.failedTier.reason,
    };
  }

  if (tierSummary.completed) {
    // markTierGeneratedComplete has written status='tier_generated' +
    // tier_generated_at. Sub-step 3 will continue the chain into
    // writeEvent; for sub-step 2 in isolation, this is the terminal.
    return {
      candidateId: input.candidateId,
      resolvedEventId: null,
      terminalStatus: "tier_generated",
      failureReason: null,
    };
  }

  // Defensive fall-through: tier orchestration neither completed nor
  // failed (e.g., its own loadTierState couldn't load the candidate row).
  // Treat as terminal facts_extracted — preserves the prior behavior.
  return {
    candidateId: input.candidateId,
    resolvedEventId: null,
    terminalStatus: "facts_extracted",
    failureReason: null,
  };
}
