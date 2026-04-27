// Manual trigger for the heuristic stage (Phase 12e.3). Bypasses BullMQ
// and calls processEnrichmentJob directly so a developer can exercise
// the heuristic seam end-to-end without Redis.
//
// Usage:
//   npm run run-ingestion-enrich --workspace=backend -- --candidate-id=<uuid>
//   npm run run-ingestion-enrich --workspace=backend -- --source=<slug>
//
// `--source=<slug>` walks all candidates with status='discovered' for
// that source in `discovered_at` ASC order and processes each in
// sequence. Useful for processing a freshly-polled batch in one shot.
//
// Shutdown: clean teardown via try/finally. No process.exit(0) — see
// followup #47 (Node-on-Windows libuv shutdown crash on
// runIngestionPoll). On fatal error, set process.exitCode = 1 and let
// the event loop drain naturally.

import "dotenv/config";
import { and, asc, eq } from "drizzle-orm";

import { db, pool } from "../db";
import { ingestionCandidates, ingestionSources } from "../db/schema";
import {
  processEnrichmentJob,
  type EnrichmentJobResult,
} from "../jobs/ingestion/enrichmentJob";
import { runHeuristicSeam } from "../jobs/ingestion/heuristicSeam";

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
        eq(ingestionCandidates.status, "discovered"),
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

    const results: EnrichmentJobResult[] = [];
    for (const candidateId of ids) {
      const r = await processEnrichmentJob(
        { candidateId, triggeredBy: "cli" },
        { seams: { runHeuristic: (id) => runHeuristicSeam(id) } },
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
