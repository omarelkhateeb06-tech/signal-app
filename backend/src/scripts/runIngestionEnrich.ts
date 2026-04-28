// Manual trigger for the heuristic + LLM relevance stages
// (Phase 12e.3 + 12e.4). Bypasses BullMQ and calls processEnrichmentJob
// directly so a developer can exercise both seams end-to-end without
// Redis. Requires ANTHROPIC_API_KEY in the env for the relevance seam
// to call Haiku (the seam returns LLM_NO_API_KEY otherwise — graceful
// degradation, not a crash).
//
// Usage:
//   npm run run-ingestion-enrich --workspace=backend -- --candidate-id=<uuid>
//   npm run run-ingestion-enrich --workspace=backend -- --source=<slug>
//
// `--source=<slug>` walks all candidates at status IN ('discovered',
// 'heuristic_passed') for that source in `discovered_at` ASC order:
//   - 'discovered' rows run heuristic + relevance in one job.
//   - 'heuristic_passed' rows skip heuristic (no-op via processed_at
//     guard at seam level — this CLI does not currently filter by
//     status mid-job, so heuristic_passed candidates re-run heuristic
//     idempotently. The DB state ends up correct either way.)
// Useful for processing a freshly-polled batch (or replaying a stuck
// batch) in one shot.
//
// Shutdown: clean teardown via try/finally. No process.exit(0) — see
// followup #47 (Node-on-Windows libuv shutdown crash on
// runIngestionPoll). On fatal error, set process.exitCode = 1 and let
// the event loop drain naturally.

import "dotenv/config";
import { and, asc, eq, inArray } from "drizzle-orm";

import { db, pool } from "../db";
import { ingestionCandidates, ingestionSources } from "../db/schema";
import {
  processEnrichmentJob,
  type EnrichmentJobResult,
  type EnrichmentSeams,
} from "../jobs/ingestion/enrichmentJob";
import { runHeuristicSeam } from "../jobs/ingestion/heuristicSeam";
import { runRelevanceSeam } from "../jobs/ingestion/relevanceSeam";

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
        inArray(ingestionCandidates.status, [
          "discovered",
          "heuristic_passed",
        ]),
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
