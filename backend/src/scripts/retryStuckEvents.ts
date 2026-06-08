// Issue #64 — operator recovery for candidates stuck at `tier_generated`.
//
// Phase 12e.5c's locked design blocks the event-write until the tier trio is
// complete, and `tier_generated` is in processEnrichmentJob's terminal-state
// short-circuit. So if writeEvent throws *after* a candidate reaches
// `status='tier_generated'` (e.g. a transient PG error that outlasts
// writeEvent's own internal retries, or genuinely-corrupt tier_outputs), the
// candidate sticks at `tier_generated` with `resolved_event_id=null` and the
// BullMQ retry returns early without re-attempting the write. This CLI is the
// recovery: it finds those stuck candidates and re-runs writeEvent (which is
// itself idempotent + internally-retrying). Operator-triggered, dry-run by
// default. Mirrors the regenerateDepthVariants CLI shape.
//
// Usage:
//   npm run retry-stuck-events --workspace=backend            # dry-run (lists)
//   npm run retry-stuck-events --workspace=backend -- --apply # re-attempt writes

import "../lib/loadEnv";
import { and, eq, isNull } from "drizzle-orm";

import { db as defaultDb, pool } from "../db";
import { ingestionCandidates } from "../db/schema";
import { writeEvent as defaultWriteEvent } from "../jobs/ingestion/writeEvent";

export interface RetryStuckDeps {
  db?: typeof defaultDb;
  writeEvent?: typeof defaultWriteEvent;
}

export interface RetryStuckResult {
  found: number;
  retried: number;
  recovered: number;
  failed: number;
  failures: { candidateId: string; reason: string }[];
}

/** Candidates stuck post-tier-generation with no event written and no terminal stamp. */
export async function findStuckCandidateIds(
  db: typeof defaultDb = defaultDb,
): Promise<string[]> {
  const rows = await db
    .select({ id: ingestionCandidates.id })
    .from(ingestionCandidates)
    .where(
      and(
        eq(ingestionCandidates.status, "tier_generated"),
        isNull(ingestionCandidates.resolvedEventId),
        isNull(ingestionCandidates.processedAt),
      ),
    );
  return rows.map((r) => r.id);
}

export async function retryStuckEvents(
  opts: { apply: boolean } & RetryStuckDeps = { apply: false },
): Promise<RetryStuckResult> {
  const db = opts.db ?? defaultDb;
  const write = opts.writeEvent ?? defaultWriteEvent;

  const ids = await findStuckCandidateIds(db);
  const result: RetryStuckResult = {
    found: ids.length,
    retried: 0,
    recovered: 0,
    failed: 0,
    failures: [],
  };
  if (!opts.apply) return result;

  for (const id of ids) {
    result.retried += 1;
    try {
      await write(id, { db });
      result.recovered += 1;
    } catch (err) {
      result.failed += 1;
      result.failures.push({
        candidateId: id,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return result;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const r = await retryStuckEvents({ apply });
  // eslint-disable-next-line no-console
  console.log(
    `[retry-stuck-events] found=${r.found}` +
      (apply
        ? ` recovered=${r.recovered} failed=${r.failed}`
        : " (dry-run — pass --apply to re-attempt the writes)"),
  );
  for (const f of r.failures) {
    // eslint-disable-next-line no-console
    console.error(`  ✗ ${f.candidateId}: ${f.reason}`);
  }
  await pool.end().catch(() => undefined);
}

// Only execute as a CLI — importing this module (e.g. from the test) must not
// run main().
if (require.main === module) {
  main().then(
    () => process.exit(0),
    (err) => {
      // eslint-disable-next-line no-console
      console.error("[retry-stuck-events] failed:", err);
      process.exit(1);
    },
  );
}
