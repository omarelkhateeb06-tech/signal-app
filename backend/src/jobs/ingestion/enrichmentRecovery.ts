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
// Detection query — a candidate is "stuck" (within the last 48h, with
// enrichment_failed = false and recovery_attempts < MAX_RECOVERY_ATTEMPTS)
// in either of two shapes:
//   (1) tier-stuck:
//       - tier_generated_at IS NULL (not all three tiers complete),
//       - tier_outputs IS NOT NULL with at least one populated key
//         (proves at least one tier already succeeded; distinguishes
//         stuck rows from rows that simply haven't reached tier
//         generation yet).
//   (2) relevance-parked (added when the relevance gate stopped
//       fail-closing transient Haiku faults into 'llm_rejected'):
//       - status = 'heuristic_passed',
//       - status_reason IN the transient-relevance set (api_error,
//         timeout, rate_limited, no_api_key, empty).
//   See TRANSIENT_RELEVANCE_REASON_STRINGS below for the full rationale.
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

import { and, eq, gt, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db as defaultDb } from "../../db";
import { ingestionCandidates } from "../../db/schema";
import {
  enqueueEnrichment as defaultEnqueueEnrichment,
} from "./enrichmentQueue";
import { TRANSIENT_RELEVANCE_REASONS } from "./relevanceSeam";

export const MAX_RECOVERY_ATTEMPTS = 3;
const STUCK_WINDOW_MS = 48 * 60 * 60 * 1000;

// A candidate is "stuck" in one of two shapes, both handled by the
// detection/finalize queries below:
//
//   (1) tier-stuck — partial tier_outputs from an earlier successful
//       tier, tier_generated_at NULL (a later tier Haiku call failed).
//       The original 12e.x recovery case.
//
//   (2) relevance-parked — the relevance gate hit a transient Haiku
//       fault (api_error / timeout / rate_limited / no_api_key / empty),
//       so enrichmentJob left the row at the non-terminal
//       'heuristic_passed' status with the transient reason in
//       status_reason instead of terminating it at 'llm_rejected'.
//       Re-enqueuing replays the gate; the enrichmentJob short-circuits
//       skip the already-run heuristic and re-run only the relevance
//       call. A normal in-flight 'heuristic_passed' row is NOT matched
//       because its status_reason is null (or a heuristic note), never a
//       transient relevance reason.
const TRANSIENT_RELEVANCE_REASON_STRINGS: string[] = [
  ...TRANSIENT_RELEVANCE_REASONS,
];

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
        // Shared guards: within the write-off window, not already
        // finalized, under the attempt cap.
        gt(ingestionCandidates.discoveredAt, since),
        eq(ingestionCandidates.enrichmentFailed, false),
        lt(ingestionCandidates.recoveryAttempts, MAX_RECOVERY_ATTEMPTS),
        or(
          // (1) tier-stuck. tier_outputs is jsonb; "at least one tier
          // key populated" is approximated by checking that the value
          // isn't the empty object. Stricter shape checks live in the
          // tierGenerationSeam — by the time tier_outputs is set in the
          // DB, at least one tier has succeeded.
          and(
            isNull(ingestionCandidates.tierGeneratedAt),
            isNotNull(ingestionCandidates.tierOutputs),
            sql`${ingestionCandidates.tierOutputs}::text <> '{}'`,
          ),
          // (2) relevance-parked by a transient Haiku fault.
          and(
            eq(ingestionCandidates.status, "heuristic_passed"),
            inArray(
              ingestionCandidates.statusReason,
              TRANSIENT_RELEVANCE_REASON_STRINGS,
            ),
          ),
        ),
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
        eq(ingestionCandidates.enrichmentFailed, false),
        sql`${ingestionCandidates.recoveryAttempts} >= ${MAX_RECOVERY_ATTEMPTS}`,
        or(
          // (1) tier-stuck exhausted.
          and(
            isNull(ingestionCandidates.tierGeneratedAt),
            isNotNull(ingestionCandidates.tierOutputs),
          ),
          // (2) relevance-parked exhausted. Status stays
          // 'heuristic_passed'; enrichment_failed=true + the rewritten
          // status_reason take it out of the detection set permanently.
          and(
            eq(ingestionCandidates.status, "heuristic_passed"),
            inArray(
              ingestionCandidates.statusReason,
              TRANSIENT_RELEVANCE_REASON_STRINGS,
            ),
          ),
        ),
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
