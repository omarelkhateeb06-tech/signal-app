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

  // ---- Fact extraction (12e.5a) ----
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

  return {
    candidateId: input.candidateId,
    resolvedEventId: null,
    terminalStatus: "facts_extracted",
    failureReason: null,
  };
}
