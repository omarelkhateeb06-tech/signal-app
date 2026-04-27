// Manual trigger for the ingestion source poll. Bypasses BullMQ and
// calls processSourcePollJob() directly so a developer can exercise an
// adapter end-to-end without Redis. Mirrors backend/src/scripts/
// runAggregation.ts.
//
// Usage:
//   npm run run-ingestion-poll --workspace=backend -- --source=<slug>
//   npm run run-ingestion-poll --workspace=backend -- --source-id=<uuid>
//
// Exits 0 on a structured result (including failureReason set), 1 on a
// thrown error (e.g. source not found).

import "dotenv/config";
import { eq } from "drizzle-orm";

import { db, pool } from "../db";
import { ingestionSources } from "../db/schema";
import { processSourcePollJob } from "../jobs/ingestion/sourcePollJob";

interface ParsedArgs {
  sourceSlug?: string;
  sourceId?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg.startsWith("--source=")) {
      out.sourceSlug = arg.slice("--source=".length);
    } else if (arg === "--source") {
      out.sourceSlug = argv[i + 1];
      i += 1;
    } else if (arg.startsWith("--source-id=")) {
      out.sourceId = arg.slice("--source-id=".length);
    } else if (arg === "--source-id") {
      out.sourceId = argv[i + 1];
      i += 1;
    }
  }
  return out;
}

async function resolveSourceId(args: ParsedArgs): Promise<string> {
  if (args.sourceId) return args.sourceId;
  if (!args.sourceSlug) {
    throw new Error("missing --source=<slug> or --source-id=<uuid>");
  }
  const rows = await db
    .select({ id: ingestionSources.id })
    .from(ingestionSources)
    .where(eq(ingestionSources.slug, args.sourceSlug))
    .limit(1);
  const row = rows[0];
  if (!row) throw new Error(`source not found: slug=${args.sourceSlug}`);
  return row.id;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  // eslint-disable-next-line no-console
  console.log(
    `[run-ingestion-poll] starting (source=${args.sourceSlug ?? args.sourceId ?? "<missing>"})`,
  );

  const sourceId = await resolveSourceId(args);
  const result = await processSourcePollJob({ sourceId, triggeredBy: "cli" });

  // eslint-disable-next-line no-console
  console.log("[run-ingestion-poll] result:", JSON.stringify(result, null, 2));

  await pool.end().catch(() => undefined);
}

main().then(
  () => process.exit(0),
  (err) => {
    // eslint-disable-next-line no-console
    console.error("[run-ingestion-poll] failed:", err);
    process.exit(1);
  },
);
