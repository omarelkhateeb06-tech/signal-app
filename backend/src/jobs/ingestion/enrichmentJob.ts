// Pure job body for the enrichment stage — Redis-free, CLI-runnable.
// Consumes one ingestion_candidates row that survived the heuristic
// filter and runs it through the four-stage Haiku pipeline:
//
//   1. relevance gate (12e.4)
//   2. fact extraction (12e.5a)
//   3. tier generation × 3 — accessible / briefed / technical (12e.5b)
//   4. write to events + event_sources OR cluster onto an existing
//      event (12e.6b)
//
// 12e.1 ships the seam only. The `seams` parameter exposes injection
// points for the heuristic filter, the Haiku client, and the embedding
// service so each downstream sub-session can fill in its own piece
// without touching the orchestration shape.

export interface EnrichmentJobInput {
  candidateId: string;
  triggeredBy?: "poll" | "cli" | "test";
}

export interface EnrichmentJobResult {
  candidateId: string;
  // Set when the candidate produced a new event.
  resolvedEventId: string | null;
  // Reflects the terminal state we wrote back to
  // ingestion_candidates.status.
  terminalStatus:
    | "heuristic_filtered"
    | "llm_rejected"
    | "published"
    | "duplicate"
    | "failed";
  failureReason: string | null;
}

// Seam interface — each method is filled in by a downstream sub-session.
// Keeping them separate (rather than importing concrete services here)
// lets enrichmentJob stay pure during 12e.1 and lets each downstream
// session land its slice without conflict.
export interface EnrichmentSeams {
  // 12e.3
  runHeuristic?: (candidateId: string) => Promise<{ pass: boolean; reason?: string }>;
  // 12e.4
  runRelevanceGate?: (
    candidateId: string,
  ) => Promise<{ relevant: boolean; sector?: string; reason?: string }>;
  // 12e.5a
  extractFacts?: (candidateId: string) => Promise<Record<string, unknown>>;
  // 12e.5b — one call per tier
  generateTier?: (
    candidateId: string,
    tier: "accessible" | "briefed" | "technical",
    facts: Record<string, unknown>,
  ) => Promise<{ thesis: string; support: string }>;
  // 12e.6a — embedding + nearest-existing-event lookup
  resolveCluster?: (
    candidateId: string,
  ) => Promise<{ eventId: string | null; similarity: number }>;
}

export async function processEnrichmentJob(
  input: EnrichmentJobInput,
  _seams: EnrichmentSeams = {},
): Promise<EnrichmentJobResult> {
  // Phase 12e.1 — scaffolding only. Returns a no-op terminal result so
  // the worker layer's plumbing can be exercised without any pipeline
  // wired up. Replaced piece-by-piece in 12e.3 → 12e.6b.
  return {
    candidateId: input.candidateId,
    resolvedEventId: null,
    terminalStatus: "failed",
    failureReason: "enrichment pipeline not yet implemented (Phase 12e.3+)",
  };
}
