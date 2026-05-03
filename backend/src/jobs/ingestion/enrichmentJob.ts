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
import type OpenAI from "openai";

import { db as defaultDb } from "../../db";
import { ingestionCandidates, ingestionSources } from "../../db/schema";
import { HEURISTIC_REASONS, type HeuristicReason } from "./heuristics";
import type { RelevanceReason, RelevanceSeamRaw, Sector } from "./relevanceSeam";
import type { FactsSeamResult } from "./factsSeam";
import type { TierSeamResult } from "./tierGenerationSeam";
import { processTierGeneration } from "./tierOrchestration";
import { writeEvent as defaultWriteEvent } from "./writeEvent";
import { captureIngestionStageFailure } from "../../lib/sentryHelpers";
import { computeEmbedding as defaultComputeEmbedding } from "./embeddingSeam";
import {
  checkCluster as defaultCheckCluster,
  type ClusterCheckResult,
} from "./clusterCheckSeam";
import { attachEventSource as defaultAttachEventSource } from "./attachEventSource";
import { getOpenAIClient } from "../../lib/openaiClient";

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
  // 12e.6a: cluster-check outcome from the embedding stage. Present when
  // the embedding seam succeeded; absent otherwise (soft-fail). 12e.6b
  // reads this to dispatch new-event vs. attach-as-alternate without a
  // second DB roundtrip.
  clusterResult?: ClusterCheckResult;
  // 12e.6b: present when the cluster-match attach path ran. true when
  // the incoming source's priority outranked the matched event's current
  // primary and the new row was promoted to role='primary'. Absent on
  // the no-match (writeEvent) branch and on attach failures.
  promoted?: boolean;
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
  // 12e.6a: per-candidate embedding + cluster check. Both run after the
  // relevance pass-write and before the facts stage. Failures in the
  // embedding seam are soft (chain continues; clusterResult is absent).
  computeEmbedding?: typeof defaultComputeEmbedding;
  checkCluster?: typeof defaultCheckCluster;
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
  // Optional override for the events row writer (12e.5c sub-step 3).
  // Defaults to `writeEvent` from writeEvent.ts. Tests inject a mock
  // to assert the call shape without exercising the full transactional
  // events + event_sources + candidate-status update chain.
  writeEvent?: typeof defaultWriteEvent;
  // Phase 12e.6b — optional override for the cluster-match attach path.
  // Defaults to `attachEventSource` from attachEventSource.ts. Tests
  // inject a mock to assert dispatch behavior without exercising the
  // full priority-comparison + transaction logic of the seam.
  attachEventSource?: typeof defaultAttachEventSource;
  // Optional override for the per-stage Sentry capture helper (12e.5c
  // sub-step 6). Defaults to `captureIngestionStageFailure` from
  // lib/sentryHelpers.ts. Tests inject a mock to assert per-stage tag
  // payloads without booting Sentry; production calls flow into the
  // real helper which is a no-op when SENTRY_DSN is unset.
  captureFailure?: typeof captureIngestionStageFailure;
  // 12e.6a — OpenAI client injected at the worker boundary. When unset,
  // the embedding seam degrades to {ok: false, embedding_api_error};
  // tests inject a mock to bypass openai SDK initialization entirely.
  openai?: OpenAI | null;
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

// Statuses that imply the heuristic stage has already produced a verdict
// (passed, since heuristic_filtered is caught upstream by TERMINAL_STATES).
// Used by the per-stage short-circuit before `runHeuristic` to skip the
// re-run that would otherwise transiently overwrite a downstream status
// (e.g., reverting 'facts_extracted' to 'heuristic_passed'), which the
// tier seam's precondition would observe as a stage-mismatch and reject.
// `duplicate` is included for consistency — a duplicate candidate has by
// definition cleared the heuristic stage. `heuristic_filtered` and
// `failed` are absent because TERMINAL_STATES catches them; `discovered`
// is absent because first-run candidates must execute the heuristic.
const HEURISTIC_ALREADY_RAN: ReadonlySet<string> = new Set([
  "heuristic_passed",
  "llm_rejected",
  "llm_relevant",
  "facts_extracted",
  "tier_generated",
  "enriching",
  "published",
  "duplicate",
]);

interface CandidateSnapshot {
  status: string;
  statusReason: string | null;
  llmJudgmentRaw: Record<string, unknown> | null;
  factsExtractedAt: Date | null;
  tierOutputs: Record<string, unknown> | null;
  resolvedEventId: string | null;
  // Joined from ingestion_sources for Sentry per-stage tagging
  // (12e.5c sub-step 6). Null if the join couldn't resolve (e.g.,
  // source row deleted with FK ON DELETE CASCADE — the candidate row
  // would also be gone, so this should be unreachable, but the
  // candidate existing without a source would defensively skip the
  // source_slug tag in Sentry capture).
  sourceSlug: string | null;
}

// Read persisted candidate state once at the top of `processEnrichmentJob`.
// Used by:
//   - the whole-job short-circuit (terminal-state guard)
//   - per-stage short-circuits (skip relevance/facts seam calls when
//     their outputs are already persisted)
//   - per-stage Sentry tagging (sub-step 6 — sourceSlug for the
//     ingestion.source_slug tag)
// Snapshot reflects state BEFORE any seam in this invocation runs —
// load-bearing for the per-stage short-circuits to read llm_judgment_raw
// / facts_extracted_at from the correct vintage even after `runHeuristic`
// transiently overwrites `status` to 'heuristic_passed'.
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
      sourceSlug: ingestionSources.slug,
    })
    .from(ingestionCandidates)
    .leftJoin(
      ingestionSources,
      eq(ingestionSources.id, ingestionCandidates.ingestionSourceId),
    )
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
  const captureFailure = deps.captureFailure ?? captureIngestionStageFailure;

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

  // Per-stage short-circuit (fix #65): skip the heuristic re-run when the
  // snapshot shows the candidate has already cleared the heuristic stage
  // on a prior invocation. Mirrors the relevance + facts pattern below.
  // Without this guard, the heuristic would re-run on a re-enqueued
  // facts_extracted candidate and transiently overwrite status to
  // 'heuristic_passed', which the tier seam's precondition reads from
  // current DB state and rejects as a stage mismatch.
  const heuristicAlreadyRan =
    snapshot !== null && HEURISTIC_ALREADY_RAN.has(snapshot.status);

  if (!heuristicAlreadyRan) {
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
  }

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
      // 12e.5c sub-step 6: per-stage Sentry tagging. Synchronous
      // captureException with stage tags after the await above
      // resolves — keeps withScope isolated under BullMQ concurrency=2.
      captureFailure({
        stage: "relevance",
        candidateId: input.candidateId,
        sourceSlug: snapshot?.sourceSlug ?? null,
        rejectionReason: relevance.rejectionReason ?? "llm_rejected",
      });
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

  // ---- Embedding + cluster check (12e.6a) ----
  // Soft-fail philosophy: any failure here logs to Sentry with stage tag
  // 'embedding' and the chain continues to facts extraction. clusterResult
  // stays absent on the result envelope when embedding fails — 12e.6b's
  // dispatch will treat absent as "no match, create new event."
  //
  // Re-enqueue safety: skip the embedding seam call when the snapshot
  // already shows the candidate past llm_relevant (i.e., facts already
  // ran or downstream stages already advanced). Mirrors the
  // facts/relevance short-circuit pattern. The snapshot vintage check
  // also guards against an unnecessary OpenAI charge on a re-enqueued
  // candidate that already has its embedding persisted.
  let clusterResult: ClusterCheckResult | undefined = undefined;
  const embeddingAlreadyDone =
    snapshot !== null &&
    (snapshot.factsExtractedAt !== null ||
      snapshot.tierOutputs !== null ||
      ["facts_extracted", "tier_generated", "enriching", "published", "duplicate"].includes(
        snapshot.status,
      ));

  if (!embeddingAlreadyDone) {
    const computeEmbedding = seams.computeEmbedding ?? defaultComputeEmbedding;
    const checkCluster = seams.checkCluster ?? defaultCheckCluster;
    const openai = deps.openai ?? getOpenAIClient();

    // Opt-in stage: skip cleanly when no openai client is available AND
    // no seam override was injected. Mirrors the relevance/facts opt-in
    // pattern (12e.4 / 12e.5a) — production passes the lazy singleton so
    // the stage always runs there; tests that don't care about embedding
    // behavior can omit both `seams.computeEmbedding` and `deps.openai`
    // to bypass the stage entirely without firing a soft-fail capture.
    const embeddingStageWired =
      openai !== null || seams.computeEmbedding !== undefined;

    if (embeddingStageWired) {
      const embeddingResult = await computeEmbedding(input.candidateId, {
        db,
        openai,
      });

      if (!embeddingResult.ok) {
        captureFailure({
          stage: "embedding",
          candidateId: input.candidateId,
          sourceSlug: snapshot?.sourceSlug ?? null,
          rejectionReason: embeddingResult.rejectionReason,
          err: embeddingResult.error,
        });
        // Soft-fail: clusterResult stays undefined, chain continues.
      } else {
        // Persist embedding to the candidate row so 12e.6b's new-event
        // write path can copy it to events without a recompute.
        await db
          .update(ingestionCandidates)
          .set({ embedding: embeddingResult.embedding })
          .where(eq(ingestionCandidates.id, input.candidateId));

        clusterResult = await checkCluster(embeddingResult.embedding, { db });
      }
    }
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
        clusterResult,
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
      // 12e.5c sub-step 6: per-stage Sentry tagging.
      captureFailure({
        stage: "facts",
        candidateId: input.candidateId,
        sourceSlug: snapshot?.sourceSlug ?? null,
        rejectionReason: facts.rejectionReason ?? "facts_parse_error",
      });
      return {
        candidateId: input.candidateId,
        resolvedEventId: null,
        terminalStatus: "failed",
        failureReason: facts.rejectionReason ?? "facts_parse_error",
        clusterResult,
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
    // 12e.5c sub-step 6: per-stage Sentry tagging. The tier-call
    // rejection class is the failed tier's reason; include the tier
    // name as a secondary signal in the rejection_reason payload.
    captureFailure({
      stage: "tiers",
      candidateId: input.candidateId,
      sourceSlug: snapshot?.sourceSlug ?? null,
      rejectionReason: `${tierSummary.failedTier.tier}:${tierSummary.failedTier.reason}`,
    });
    return {
      candidateId: input.candidateId,
      resolvedEventId: null,
      terminalStatus: "failed",
      failureReason: tierSummary.failedTier.reason,
      clusterResult,
    };
  }

  if (tierSummary.completed) {
    // markTierGeneratedComplete has written status='tier_generated' +
    // tier_generated_at. The chain now dispatches into one of two
    // event-write paths based on 12e.6a's clusterResult:
    //
    //   matched   → 12e.6b attachEventSource: row added to event_sources
    //               (role='alternate', or 'primary' if the incoming
    //               source's priority outranks the current primary and
    //               the existing primary is demoted in the same txn).
    //               Candidate published with resolved_event_id pointing
    //               at the matched event.
    //   no match  → 12e.5c writeEvent: insert new events row + primary
    //               event_sources row + advance candidate to published.
    //   absent    → embedding seam soft-failed; treat as no-match and
    //               fall through to writeEvent (avoids losing a candidate
    //               on an embedding outage).
    if (clusterResult?.matched) {
      const runAttach = deps.attachEventSource ?? defaultAttachEventSource;
      const attachResult = await runAttach(
        {
          candidateId: input.candidateId,
          matchedEventId: clusterResult.matchedEventId,
          similarity: clusterResult.similarity,
        },
        { db },
      );
      if (!attachResult.ok) {
        captureFailure({
          stage: "attach_event_source",
          candidateId: input.candidateId,
          sourceSlug: snapshot?.sourceSlug ?? null,
          rejectionReason: attachResult.rejectionReason,
          err: attachResult.error,
        });
        return {
          candidateId: input.candidateId,
          resolvedEventId: null,
          terminalStatus: "failed",
          failureReason: `attach_error: ${attachResult.rejectionReason}`,
          clusterResult,
        };
      }
      return {
        candidateId: input.candidateId,
        resolvedEventId: clusterResult.matchedEventId,
        terminalStatus: "published",
        failureReason: null,
        clusterResult,
        promoted: attachResult.promoted,
      };
    }

    const runWriteEvent = deps.writeEvent ?? defaultWriteEvent;
    try {
      const { eventId } = await runWriteEvent(input.candidateId, { db });
      return {
        candidateId: input.candidateId,
        resolvedEventId: eventId,
        terminalStatus: "published",
        failureReason: null,
        clusterResult,
      };
    } catch (err) {
      // writeEvent throws on validation failures (assertTierTemplate)
      // or DB-level constraint/connection errors. Surface as terminal
      // 'failed' in the result envelope so the worker's done log
      // captures it; sub-step 6/7 will add Sentry capture inside this
      // catch block.
      //
      // KNOWN LIMITATION: writeEvent failures leave the candidate at
      // status='tier_generated' (markTierGeneratedComplete committed
      // before writeEvent's transaction attempted; writeEvent's
      // transaction rolls back atomically but the upstream tier-status
      // commit stands). Per the planner-locked decision 4 ("Partial
      // state lives on ingestion_candidates, never events"), this is
      // the intended partial-state semantics: tier_generated WITH
      // resolved_event_id=null means "tier work done, event-write
      // pending or failed." A subsequent BullMQ retry on this job
      // hits the whole-job short-circuit (tier_generated ∈
      // TERMINAL_STATES) and returns terminalStatus='tier_generated'
      // — does NOT auto-re-attempt writeEvent. Manual retry requires
      // a separate mechanism (CLI sweep or out-of-band re-enqueue);
      // tracked as a follow-up issue.
      const detail = err instanceof Error ? err.message : String(err);
      // 12e.5c sub-step 6: per-stage Sentry tagging. Pass the original
      // error object through so its stack trace is preserved (writeEvent
      // throws ZodError on assertTierTemplate failure or PG errors on
      // constraint/connection issues — both have useful stacks).
      captureFailure({
        stage: "write_event",
        candidateId: input.candidateId,
        sourceSlug: snapshot?.sourceSlug ?? null,
        rejectionReason: `write_event_error: ${detail}`,
        err,
      });
      return {
        candidateId: input.candidateId,
        resolvedEventId: null,
        terminalStatus: "failed",
        failureReason: `write_event_error: ${detail}`,
        clusterResult,
      };
    }
  }

  // Defensive fall-through: tier orchestration neither completed nor
  // failed (e.g., its own loadTierState couldn't load the candidate row).
  // Treat as terminal facts_extracted — preserves the prior behavior.
  // 12e.5c sub-step 6: capture as an anomalous tier-stage outcome so
  // the soak surface picks up the rare degenerate state.
  captureFailure({
    stage: "tiers",
    candidateId: input.candidateId,
    sourceSlug: snapshot?.sourceSlug ?? null,
    rejectionReason: "tier_orchestration_indeterminate",
  });
  return {
    candidateId: input.candidateId,
    resolvedEventId: null,
    terminalStatus: "facts_extracted",
    clusterResult,
    failureReason: null,
  };
}
