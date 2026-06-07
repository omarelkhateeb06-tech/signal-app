// Phase 12n.2 — native-post enrichment orchestrator.
//
// Native posts are AI-authored editorial events synthesized from already-
// ingested signals (the first generator is GitHub trending). A native
// generator produces an `ingestion_candidates` row that already carries
// the authored body + sector, then hands the candidate id here.
//
// This orchestrator deliberately does NOT reuse `processEnrichmentJob`.
// Native posts skip exactly the three most delicate enrichment stages:
//
//   1. Relevance gate — SKIPPED. We authored the content; the sector is
//      set by the generator at candidate-insert time, not judged by
//      Haiku. (Running the LLM relevance gate on our own content risks
//      it rejecting a post we deliberately wrote.)
//   2. Embedding + cluster check — SKIPPED. Clustering attaches near-
//      duplicate ingested items as *alternates* to an existing event;
//      if a native post clustered onto an event it would be hidden as an
//      alternate instead of rendering as its own post. Native always
//      writes a NEW event.
//   3. Heuristic body fetch — SKIPPED. The candidate already carries the
//      authored `body_text`; there is no URL to fetch + extract.
//
// What it DOES run is the same downstream seams as ingested stories, so
// native posts get all three depth tiers identically:
//
//   facts extraction → tier generation ×3 (accessible/briefed/technical)
//   → writeEvent (new events row, source_type='native' via adapter_type)
//
// Skip-by-construction (a separate orchestrator) rather than skip-by-
// branch (flags inside processEnrichmentJob) is the locked design: native
// code never touches the relevance/cluster stages, so future changes
// there can't affect native, and enrichmentJob.ts stays byte-identical
// with its test suite untouched.
//
// The seam result/persistence shapes mirror the facts + tier branches of
// processEnrichmentJob exactly — same column writes, same status advance.

import { eq } from "drizzle-orm";

import { db as defaultDb } from "../../db";
import { ingestionCandidates } from "../../db/schema";
import { runFactsSeam, type FactsSeamResult } from "./factsSeam";
import { processTierGeneration } from "./tierOrchestration";
import { writeEvent as defaultWriteEvent } from "./writeEvent";
import { captureIngestionStageFailure } from "../../lib/sentryHelpers";
import { generateAndStoreIllustration } from "../../services/illustrationService";
import { VALID_SECTORS } from "./relevanceSeam";

export interface NativeEnrichmentInput {
  candidateId: string;
  triggeredBy?: "cli" | "test" | "cron";
  // The ingestion_sources.slug of the generator that produced this candidate.
  // When provided, the illustration service uses it to pick the right visual
  // archetype. Omitting it is safe — the service falls back to "signal".
  generatorSlug?: string;
}

export interface NativeEnrichmentResult {
  candidateId: string;
  resolvedEventId: string | null;
  terminalStatus:
    | "facts_extracted"
    | "tier_generated"
    | "published"
    | "failed";
  failureReason: string | null;
}

export interface NativeEnrichmentDeps {
  db?: typeof defaultDb;
  // Test seams — default to the production implementations.
  runFacts?: typeof runFactsSeam;
  processTier?: typeof processTierGeneration;
  writeEvent?: typeof defaultWriteEvent;
  captureFailure?: typeof captureIngestionStageFailure;
}

interface NativeCandidateSnapshot {
  status: string;
  sector: string | null;
  bodyText: string | null;
}

async function loadSnapshot(
  db: typeof defaultDb,
  candidateId: string,
): Promise<NativeCandidateSnapshot | null> {
  const rows = await db
    .select({
      status: ingestionCandidates.status,
      sector: ingestionCandidates.sector,
      bodyText: ingestionCandidates.bodyText,
    })
    .from(ingestionCandidates)
    .where(eq(ingestionCandidates.id, candidateId))
    .limit(1);
  return (rows[0] as NativeCandidateSnapshot | undefined) ?? null;
}

// Statuses at which the chain has terminated. A re-run returns
// immediately rather than re-charging Haiku or re-writing the event.
const TERMINAL_STATES: ReadonlySet<string> = new Set([
  "tier_generated",
  "published",
  "failed",
]);

function isValidSector(value: string | null): boolean {
  return value !== null && (VALID_SECTORS as readonly string[]).includes(value);
}

export async function processNativeEnrichment(
  input: NativeEnrichmentInput,
  deps: NativeEnrichmentDeps = {},
): Promise<NativeEnrichmentResult> {
  const db = deps.db ?? defaultDb;
  const runFacts = deps.runFacts ?? runFactsSeam;
  const runTier = deps.processTier ?? processTierGeneration;
  const runWriteEvent = deps.writeEvent ?? defaultWriteEvent;
  const captureFailure = deps.captureFailure ?? captureIngestionStageFailure;
  const { candidateId, generatorSlug } = input;

  const snapshot = await loadSnapshot(db, candidateId);
  if (!snapshot) {
    return {
      candidateId,
      resolvedEventId: null,
      terminalStatus: "failed",
      failureReason: "candidate_not_found",
    };
  }

  // Whole-job short-circuit on terminal states. tier_generated means the
  // event-write is pending/failed (same partial-state semantics as
  // processEnrichmentJob); we do not auto-re-attempt writeEvent here.
  if (TERMINAL_STATES.has(snapshot.status)) {
    return {
      candidateId,
      resolvedEventId: null,
      terminalStatus:
        snapshot.status as NativeEnrichmentResult["terminalStatus"],
      failureReason: snapshot.status === "failed" ? "terminal_failed" : null,
    };
  }

  // Preconditions the generator must satisfy at candidate-insert time.
  // Native candidates carry their own sector + authored body; if either
  // is missing the contract was violated upstream.
  if (!isValidSector(snapshot.sector)) {
    await markFailed(db, candidateId, "native_invalid_sector");
    captureFailure({
      stage: "relevance",
      candidateId,
      sourceSlug: null,
      rejectionReason: "native_invalid_sector",
    });
    return {
      candidateId,
      resolvedEventId: null,
      terminalStatus: "failed",
      failureReason: "native_invalid_sector",
    };
  }
  if (!snapshot.bodyText || snapshot.bodyText.trim().length === 0) {
    await markFailed(db, candidateId, "native_empty_body");
    captureFailure({
      stage: "facts",
      candidateId,
      sourceSlug: null,
      rejectionReason: "native_empty_body",
    });
    return {
      candidateId,
      resolvedEventId: null,
      terminalStatus: "failed",
      failureReason: "native_empty_body",
    };
  }

  // ---- Fact extraction ----
  const facts: FactsSeamResult = await runFacts(candidateId, { db });
  if (!facts.ok) {
    const reason = facts.rejectionReason ?? "facts_parse_error";
    await db
      .update(ingestionCandidates)
      .set({
        status: "failed",
        statusReason: reason,
        factsExtractionRaw: facts.raw
          ? (facts.raw as unknown as Record<string, unknown>)
          : undefined,
        processedAt: new Date(),
      })
      .where(eq(ingestionCandidates.id, candidateId));
    captureFailure({
      stage: "facts",
      candidateId,
      sourceSlug: null,
      rejectionReason: reason,
    });
    return {
      candidateId,
      resolvedEventId: null,
      terminalStatus: "failed",
      failureReason: reason,
    };
  }

  await db
    .update(ingestionCandidates)
    .set({
      status: "facts_extracted",
      facts: facts.facts as unknown as Record<string, unknown>,
      factsExtractedAt: new Date(),
      factsExtractionRaw: facts.raw
        ? (facts.raw as unknown as Record<string, unknown>)
        : undefined,
      statusReason: null,
      processedAt: new Date(),
    })
    .where(eq(ingestionCandidates.id, candidateId));

  // ---- Tier generation ×3 ----
  const tierSummary = await runTier(candidateId, { db });
  if (tierSummary.failedTier) {
    captureFailure({
      stage: "tiers",
      candidateId,
      sourceSlug: null,
      rejectionReason: `${tierSummary.failedTier.tier}:${tierSummary.failedTier.reason}`,
    });
    return {
      candidateId,
      resolvedEventId: null,
      terminalStatus: "failed",
      failureReason: tierSummary.failedTier.reason,
    };
  }
  if (!tierSummary.completed) {
    captureFailure({
      stage: "tiers",
      candidateId,
      sourceSlug: null,
      rejectionReason: "tier_orchestration_indeterminate",
    });
    return {
      candidateId,
      resolvedEventId: null,
      terminalStatus: "facts_extracted",
      failureReason: null,
    };
  }

  // ---- Write event (new event, never attach as alternate) ----
  try {
    const { eventId } = await runWriteEvent(candidateId, { db });

    // Phase C — illustration generation. Awaited so the CLI path (which exits
    // when the loop returns) doesn't terminate before the image is stored, and
    // so the published event reflects its final state. The service is itself
    // soft-fail (missing key / API error / out of credits → returns null); the
    // extra try/catch guarantees even an unexpected throw can't undo a publish.
    if (generatorSlug) {
      try {
        await generateAndStoreIllustration(eventId, generatorSlug, { db });
      } catch {
        // Illustration is best-effort; the event is already published.
      }
    }

    return {
      candidateId,
      resolvedEventId: eventId,
      terminalStatus: "published",
      failureReason: null,
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    captureFailure({
      stage: "write_event",
      candidateId,
      sourceSlug: null,
      rejectionReason: `write_event_error: ${detail}`,
      err,
    });
    return {
      candidateId,
      resolvedEventId: null,
      terminalStatus: "failed",
      failureReason: `write_event_error: ${detail}`,
    };
  }
}

async function markFailed(
  db: typeof defaultDb,
  candidateId: string,
  reason: string,
): Promise<void> {
  await db
    .update(ingestionCandidates)
    .set({ status: "failed", statusReason: reason, processedAt: new Date() })
    .where(eq(ingestionCandidates.id, candidateId));
}
