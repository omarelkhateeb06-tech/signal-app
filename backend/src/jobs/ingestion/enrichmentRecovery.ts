// Phase 12e.x fix cluster — enrichment recovery (#64).
//
// Some candidates land in a partial-tier_outputs state after a Haiku
// timeout / parse error on one of the three tier-generation calls.
// The original enrichment worker treated the run as terminal-failed
// and moved on, but the row still has SOME tier_outputs from the
// earlier successful tiers. Re-enqueuing the candidate replays the
// orchestration; the tier seam itself is idempotent per-tier (a
// candidate whose tier already exists in tier_outputs is skipped by
// the seam), so a recovery run only fills the gaps.
//
// Detection query — a candidate is "stuck" when:
//   - created within the last 48h (older rows are written off),
//   - tier_generated_at IS NULL (not all three tiers complete),
//   - tier_outputs IS NOT NULL with at least one populated key
//     (proves at least one tier already succeeded; distinguishes
//     stuck rows from rows that simply haven't reached tier
//     generation yet),
//   - enrichment_failed = false (we haven't given up on it),
//   - recovery_attempts < MAX_RECOVERY_ATTEMPTS.
//
// On every scheduler run, each matching candidate:
//   - has recovery_attempts bumped by 1,
//   - gets re-enqueued via enqueueEnrichment (the worker's
//     orchestration body handles the rest, including filling any
//     missing tiers + writing the event + populating generic_commentary).
//
// On the 3rd run (recovery_attempts → 3 after the bump), if the
// candidate is *still* stuck on the next pass, the next iteration's
// guard (`recovery_attempts < MAX_RECOVERY_ATTEMPTS`) excludes it,
// and a separate finalize step marks `enrichment_failed = true` so it
// never reappears.
//
// Idempotency. The detection query is a pure read; nothing mutates
// rows that no longer match. The re-enqueue is a BullMQ add with no
// dedup — a candidate that briefly enters the detection set, gets
// enqueued, then completes naturally before the next 6h tick is
// simply not selected next time.

import { and, eq, gt, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { db as defaultDb } from "../../db";
import { ingestionCandidates } from "../../db/schema";
import {
  enqueueEnrichment as defaultEnqueueEnrichment,
} from "./enrichmentQueue";

export const MAX_RECOVERY_ATTEMPTS = 3;
const STUCK_WINDOW_MS = 48 * 60 * 60 * 1000;

export interface RecoveryDeps {
  db?: typeof defaultDb;
  now?: () => Date;
  enqueueEnrichment?: typeof defaultEnqueueEnrichment;
}

export interface RecoveryResult {
  scanned: number;
  reEnqueued: number;
  markedFailed: number;
}

/**
 * Read-only — returns the candidate IDs that match the stuck-state
 * detection query. Exported separately so the scheduler can log the
 * count (and a future admin route can surface it) without forcing a
 * write.
 */
export async function findStuckCandidates(
  deps: RecoveryDeps = {},
): Promise<string[]> {
  const db = deps.db ?? defaultDb;
  const now = deps.now ?? ((): Date => new Date());
  const since = new Date(now().getTime() - STUCK_WINDOW_MS);

  const rows = await db
    .select({ id: ingestionCandidates.id })
    .from(ingestionCandidates)
    .where(
      and(
        gt(ingestionCandidates.discoveredAt, since),
        isNull(ingestionCandidates.tierGeneratedAt),
        isNotNull(ingestionCandidates.tierOutputs),
        eq(ingestionCandidates.enrichmentFailed, false),
        lt(ingestionCandidates.recoveryAttempts, MAX_RECOVERY_ATTEMPTS),
        // tier_outputs is jsonb; "at least one tier key populated"
        // is approximated by checking that the value isn't the
        // empty object. Stricter shape checks live in the
        // tierGenerationSeam — by the time tier_outputs is set in the
        // DB, at least one tier has succeeded.
        sql`${ingestionCandidates.tierOutputs}::text <> '{}'`,
      ),
    );
  return rows.map((r) => r.id);
}

/**
 * Mark candidates terminally failed when their recovery_attempts has
 * already hit the cap AND they're still in the stuck shape on the
 * subsequent scheduler run. Runs after the re-enqueue loop so a
 * candidate that already exhausted its attempts doesn't get a 4th try.
 * Returns the count finalized.
 */
async function finalizeExhausted(
  deps: Required<Pick<RecoveryDeps, "db" | "now">>,
): Promise<number> {
  const since = new Date(deps.now().getTime() - STUCK_WINDOW_MS);
  const rows = await deps.db
    .update(ingestionCandidates)
    .set({
      enrichmentFailed: true,
      statusReason: "enrichment_failed_after_recovery",
    })
    .where(
      and(
        gt(ingestionCandidates.discoveredAt, since),
        isNull(ingestionCandidates.tierGeneratedAt),
        isNotNull(ingestionCandidates.tierOutputs),
        eq(ingestionCandidates.enrichmentFailed, false),
        sql`${ingestionCandidates.recoveryAttempts} >= ${MAX_RECOVERY_ATTEMPTS}`,
      ),
    )
    .returning({ id: ingestionCandidates.id });
  return rows.length;
}

/**
 * Discovery + re-enqueue + finalize, in that order. Returns the run
 * counters so the scheduler can log them; the per-candidate enqueue
 * failure mode is structured-logged but never aborts the batch.
 */
export async function recoverStuckCandidates(
  deps: RecoveryDeps = {},
): Promise<RecoveryResult> {
  const db = deps.db ?? defaultDb;
  const now = deps.now ?? ((): Date => new Date());
  const enqueueEnrichment =
    deps.enqueueEnrichment ?? defaultEnqueueEnrichment;

  const ids = await findStuckCandidates({ db, now });
  let reEnqueued = 0;

  for (const id of ids) {
    try {
      // Bump the attempt counter first so a failed enqueue still
      // costs an attempt — otherwise a flapping Redis would let a
      // candidate cycle forever.
      await db
        .update(ingestionCandidates)
        .set({ recoveryAttempts: sql`${ingestionCandidates.recoveryAttempts} + 1` })
        .where(eq(ingestionCandidates.id, id));

      await enqueueEnrichment({ candidateId: id, triggeredBy: "cli" });
      reEnqueued += 1;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `[enrichment-recovery] enqueue failed for candidate=${id}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  const markedFailed = await finalizeExhausted({ db, now });

  return { scanned: ids.length, reEnqueued, markedFailed };
}
