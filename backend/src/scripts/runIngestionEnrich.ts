// Manual trigger for the heuristic + LLM relevance + fact-extraction
// stages (Phase 12e.3 + 12e.4 + 12e.5a). Bypasses BullMQ and calls
// processEnrichmentJob directly so a developer can exercise all three
// seams end-to-end without Redis. Requires ANTHROPIC_API_KEY in the env
// for the relevance + facts seams to call Haiku (the seams return
// {LLM,FACTS}_NO_API_KEY otherwise — graceful degradation, not a crash).
//
// Usage:
//   npm run run-ingestion-enrich --workspace=backend -- --candidate-id=<uuid>
//   npm run run-ingestion-enrich --workspace=backend -- --source=<slug>
//
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
//     Wasteful but functionally correct; acceptable for a dev CLI. Cron
//     path goes end-to-end in one orchestration run and never re-enters
//     this branch.
// Useful for processing a freshly-polled batch (or replaying a stuck
// batch) in one shot.
//
// Shutdown: clean teardown via try/finally. No process.exit(0) — see
// followup #47 (Node-on-Windows libuv shutdown crash on
// runIngestionPoll). On fatal error, set process.exitCode = 1 and let
// the event loop drain naturally.

import "dotenv/config";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";

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

async function resolveCandidateIds(args: ParsedArgs): Promise<string[]> {
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

async function main(): Promise<void> {
  try {
    const args = parseArgs(process.argv.slice(2));
    // eslint-disable-next-line no-console
    console.log(
      `[run-ingestion-enrich] starting (candidate=${args.candidateId ?? "<none>"}, source=${args.sourceSlug ?? "<none>"})`,
    );

    const ids = await resolveCandidateIds(args);
    // eslint-disable-next-line no-console
    console.log(`[run-ingestion-enrich] processing ${ids.length} candidate(s)`);

    const seams: EnrichmentSeams = {
      runHeuristic: (id) => runHeuristicSeam(id),
      runRelevanceGate: (id) => runRelevanceSeam(id),
      extractFacts: (id) => runFactsSeam(id),
    };

    const results: EnrichmentJobResult[] = [];
    for (const candidateId of ids) {
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

    const summary = results.reduce<Record<string, number>>((acc, r) => {
      acc[r.terminalStatus] = (acc[r.terminalStatus] ?? 0) + 1;
      return acc;
    }, {});
    // eslint-disable-next-line no-console
    console.log("[run-ingestion-enrich] summary:", JSON.stringify(summary, null, 2));
  } finally {
    await pool.end().catch(() => undefined);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[run-ingestion-enrich] fatal:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
