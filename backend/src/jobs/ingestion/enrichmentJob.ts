// Pure job body for the enrichment stage — Redis-free, CLI-runnable.
// Consumes one ingestion_candidates row and runs it through the four-
// stage pipeline:
//
//   1. heuristic gate (12e.3) ← THIS SUB-SESSION FILLS THIS IN
//   2. relevance gate (12e.4)
//   3. fact extraction (12e.5a)
//   4. tier generation × 3 — accessible / briefed / technical (12e.5b)
//   5. write to events + event_sources OR cluster onto an existing
//      event (12e.6b)
//
// 12e.3 wires the heuristic seam fully — pre-fetch checks + body fetch
// + post-fetch length floor — and writes status / status_reason /
// body_text back to the DB. Status terminal possibilities at this
// stage are `heuristic_filtered` (rejected, with reason) or
// `heuristic_passed` (cleared, body persisted, awaiting 12e.4 LLM
// relevance gate). All other stages remain seams.

import { eq } from "drizzle-orm";

import { db as defaultDb } from "../../db";
import { ingestionCandidates } from "../../db/schema";
import { HEURISTIC_REASONS, type HeuristicReason } from "./heuristics";

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
  ) => Promise<{ relevant: boolean; sector?: string; reason?: string }>;
  extractFacts?: (candidateId: string) => Promise<Record<string, unknown>>;
  generateTier?: (
    candidateId: string,
    tier: "accessible" | "briefed" | "technical",
    facts: Record<string, unknown>,
  ) => Promise<{ thesis: string; support: string }>;
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

  // FUTURE (12e.4): if seams.runRelevanceGate is provided, continue
  // with the relevance gate here rather than terminating.
  return {
    candidateId: input.candidateId,
    resolvedEventId: null,
    terminalStatus: "heuristic_passed",
    failureReason: null,
  };
}
