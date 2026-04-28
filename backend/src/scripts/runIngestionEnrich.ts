// Manual trigger for the heuristic + LLM relevance + fact-extraction +
// tier-generation stages (Phase 12e.3 + 12e.4 + 12e.5a + 12e.5b).
// Bypasses BullMQ and calls processEnrichmentJob directly so a developer
// can exercise the seams end-to-end without Redis. Requires
// ANTHROPIC_API_KEY in the env for the relevance + facts + tier seams
// to call Haiku (the seams return {LLM,FACTS,TIER}_NO_API_KEY otherwise
// — graceful degradation, not a crash).
//
// Usage:
//   npm run run-ingestion-enrich --workspace=backend -- --candidate-id=<uuid>
//   npm run run-ingestion-enrich --workspace=backend -- --source=<slug>
//
// Two cohorts are walked per invocation:
//
// COHORT A (heuristic + relevance + facts via processEnrichmentJob):
// `--source=<slug>` walks all candidates at status IN ('discovered',
// 'heuristic_passed', 'llm_relevant') for that source in `discovered_at`
// ASC order, with `llm_relevant` rows additionally gated on
// `facts_extracted_at IS NULL` so already-extracted candidates are
// skipped (idempotency lives at the row-selection layer per the 12e.5a
// locked decision; the seam itself does not short-circuit):
//   - 'discovered' rows run heuristic + relevance + facts in one job.
//   - 'heuristic_passed' rows re-run heuristic idempotently and continue
//     through relevance + facts.
//   - 'llm_relevant' rows re-run heuristic + relevance (paying an extra
//     Haiku call for the relevance re-classification) and then run facts.
//
// COHORT B (tier generation via runTierGenerationSeam, 12e.5b):
// After cohort A, the CLI sweeps candidates at status='facts_extracted'
// OR (status='tier_generated' AND tier_generated_at IS NULL — defensive,
// catches partial-state rows whose status was prematurely advanced) and
// runs the three tier-generation calls in order. Per-tier idempotency
// lives in the JSONB column (`tier_outputs->>'<tier>' IS NOT NULL` →
// skip). Status advances to `tier_generated` with `tier_generated_at`
// stamped only when all three keys are present; on any partial failure
// the row stays at `facts_extracted` with `status_reason` set to the
// failed tier's reason, so the next CLI invocation picks it up and
// re-runs only the missing tiers (the cost-asymmetric retry pattern
// from the 12e.5b stage 1 audit §7).
//
// `--candidate-id=<uuid>` runs both cohorts for that single candidate
// (whichever cohort applies based on its current status).
//
// Useful for processing a freshly-polled batch (or replaying a stuck
// batch) in one shot.
//
// Shutdown: clean teardown via try/finally. No process.exit(0) — see
// followup #47 (Node-on-Windows libuv shutdown crash on
// runIngestionPoll). On fatal error, set process.exitCode = 1 and let
// the event loop drain naturally.

import "dotenv/config";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";

import { db, pool } from "../db";
import { ingestionCandidates, ingestionSources } from "../db/schema";
import {
  processEnrichmentJob,
  type EnrichmentJobResult,
  type EnrichmentSeams,
} from "../jobs/ingestion/enrichmentJob";
import { runHeuristicSeam } from "../jobs/ingestion/heuristicSeam";
import { runRelevanceSeam } from "../jobs/ingestion/relevanceSeam";
import { runFactsSeam } from "../jobs/ingestion/factsSeam";
import {
  processTierGeneration,
  type TierProcessSummary,
} from "../jobs/ingestion/tierOrchestration";

interface ParsedArgs {
  candidateId?: string;
  sourceSlug?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg.startsWith("--candidate-id=")) {
      out.candidateId = arg.slice("--candidate-id=".length);
    } else if (arg === "--candidate-id") {
      out.candidateId = argv[i + 1];
      i += 1;
    } else if (arg.startsWith("--source=")) {
      out.sourceSlug = arg.slice("--source=".length);
    } else if (arg === "--source") {
      out.sourceSlug = argv[i + 1];
      i += 1;
    }
  }
  return out;
}

async function resolveEnrichmentCandidateIds(args: ParsedArgs): Promise<string[]> {
  if (args.candidateId) return [args.candidateId];
  if (!args.sourceSlug) {
    throw new Error("missing --candidate-id=<uuid> or --source=<slug>");
  }

  const sourceRows = await db
    .select({ id: ingestionSources.id })
    .from(ingestionSources)
    .where(eq(ingestionSources.slug, args.sourceSlug))
    .limit(1);
  const source = sourceRows[0];
  if (!source) throw new Error(`source not found: slug=${args.sourceSlug}`);

  const candidates = await db
    .select({ id: ingestionCandidates.id })
    .from(ingestionCandidates)
    .where(
      and(
        eq(ingestionCandidates.ingestionSourceId, source.id),
        // 12e.4: pick up both fresh and partially-processed candidates
        // so re-runs after a stuck batch are picked up. Re-running
        // heuristic on a heuristic_passed row is idempotent in the
        // seam: same recency / noise / body decisions reach the same
        // verdict against the same row.
        // 12e.5a: also pick up llm_relevant rows that haven't been
        // fact-extracted yet. Idempotency lives at the query level —
        // facts_extracted_at IS NULL gates the cohort.
        or(
          inArray(ingestionCandidates.status, [
            "discovered",
            "heuristic_passed",
          ]),
          and(
            eq(ingestionCandidates.status, "llm_relevant"),
            isNull(ingestionCandidates.factsExtractedAt),
          ),
        ),
      ),
    )
    .orderBy(asc(ingestionCandidates.discoveredAt));
  return candidates.map((c) => c.id);
}

async function resolveTierCandidateIds(args: ParsedArgs): Promise<string[]> {
  if (args.candidateId) return [args.candidateId];
  if (!args.sourceSlug) return [];

  const sourceRows = await db
    .select({ id: ingestionSources.id })
    .from(ingestionSources)
    .where(eq(ingestionSources.slug, args.sourceSlug))
    .limit(1);
  const source = sourceRows[0];
  if (!source) return [];

  // Pick up:
  //   - status='facts_extracted' (fresh cohort, no tiers run yet OR
  //     partial — partial means status stayed at facts_extracted because
  //     a tier failed; tier_outputs may have some keys populated).
  //   - status='tier_generated' AND tier_generated_at IS NULL —
  //     defensive only. Should not normally exist (the orchestrator
  //     stamps tier_generated_at and tier_generated atomically), but if
  //     a row drifted into this state we want to recover it.
  // facts IS NOT NULL is required (no facts → seam terminal-rejects).
  const candidates = await db
    .select({ id: ingestionCandidates.id })
    .from(ingestionCandidates)
    .where(
      and(
        eq(ingestionCandidates.ingestionSourceId, source.id),
        or(
          eq(ingestionCandidates.status, "facts_extracted"),
          and(
            eq(ingestionCandidates.status, "tier_generated"),
            isNull(ingestionCandidates.tierGeneratedAt),
          ),
        ),
        sql`${ingestionCandidates.facts} IS NOT NULL`,
      ),
    )
    .orderBy(asc(ingestionCandidates.discoveredAt));
  return candidates.map((c) => c.id);
}

async function main(): Promise<void> {
  try {
    const args = parseArgs(process.argv.slice(2));
    // eslint-disable-next-line no-console
    console.log(
      `[run-ingestion-enrich] starting (candidate=${args.candidateId ?? "<none>"}, source=${args.sourceSlug ?? "<none>"})`,
    );

    // Cohort A: heuristic + relevance + facts.
    const enrichmentIds = await resolveEnrichmentCandidateIds(args);
    // eslint-disable-next-line no-console
    console.log(
      `[run-ingestion-enrich] cohort A (heuristic+relevance+facts): ${enrichmentIds.length} candidate(s)`,
    );

    const seams: EnrichmentSeams = {
      runHeuristic: (id) => runHeuristicSeam(id),
      runRelevanceGate: (id) => runRelevanceSeam(id),
      extractFacts: (id) => runFactsSeam(id),
    };

    const results: EnrichmentJobResult[] = [];
    for (const candidateId of enrichmentIds) {
      const r = await processEnrichmentJob(
        { candidateId, triggeredBy: "cli" },
        { seams },
      );
      results.push(r);
      // eslint-disable-next-line no-console
      console.log(
        `[run-ingestion-enrich]   ${candidateId} -> ${r.terminalStatus}${r.failureReason ? ` (${r.failureReason})` : ""}`,
      );
    }

    const enrichmentSummary = results.reduce<Record<string, number>>(
      (acc, r) => {
        acc[r.terminalStatus] = (acc[r.terminalStatus] ?? 0) + 1;
        return acc;
      },
      {},
    );
    // eslint-disable-next-line no-console
    console.log(
      "[run-ingestion-enrich] cohort A summary:",
      JSON.stringify(enrichmentSummary, null, 2),
    );

    // Cohort B: tier generation (12e.5b).
    const tierIds = await resolveTierCandidateIds(args);
    // eslint-disable-next-line no-console
    console.log(
      `[run-ingestion-enrich] cohort B (tier generation): ${tierIds.length} candidate(s)`,
    );

    const tierSummaries: TierProcessSummary[] = [];
    for (const candidateId of tierIds) {
      const s = await processTierGeneration(candidateId);
      tierSummaries.push(s);
      const status = s.completed
        ? "tier_generated"
        : s.failedTier
          ? `partial(${s.failedTier.tier}=${s.failedTier.reason})`
          : "noop";
      // eslint-disable-next-line no-console
      console.log(
        `[run-ingestion-enrich]   ${candidateId} -> ${status} (ran=${s.ranTiers.join(",") || "-"} skipped=${s.skippedTiers.join(",") || "-"})`,
      );
    }

    const tierStatusSummary = tierSummaries.reduce<Record<string, number>>(
      (acc, s) => {
        const key = s.completed
          ? "tier_generated"
          : s.failedTier
            ? `partial:${s.failedTier.reason}`
            : "noop";
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      },
      {},
    );
    // eslint-disable-next-line no-console
    console.log(
      "[run-ingestion-enrich] cohort B summary:",
      JSON.stringify(tierStatusSummary, null, 2),
    );
  } finally {
    await pool.end().catch(() => undefined);
  }
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[run-ingestion-enrich] fatal:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
