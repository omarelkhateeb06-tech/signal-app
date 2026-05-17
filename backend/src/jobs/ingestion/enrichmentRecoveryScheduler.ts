// Phase 12e.x fix cluster — scheduler for the enrichment recovery
// pass. node-cron matches the existing emailScheduler pattern; the
// job is read-mostly + per-candidate writes, so a single in-process
// cron is the simplest fit (a BullMQ repeatable would add a dedicated
// queue + worker + boot wiring for no benefit at the current scale).
//
// Default fires every 6 hours; overridable via ENRICHMENT_RECOVERY_CRON
// for ops experimentation. Disable with DISABLE_ENRICHMENT_RECOVERY=1
// for local dev where partial enrichments don't matter.

import cron, { type ScheduledTask } from "node-cron";
import { recoverStuckCandidates } from "./enrichmentRecovery";

const ENRICHMENT_RECOVERY_CRON =
  process.env.ENRICHMENT_RECOVERY_CRON ?? "0 */6 * * *";

let cachedTask: ScheduledTask | null = null;

export function startEnrichmentRecoveryScheduler(): ScheduledTask | null {
  if (cachedTask) return cachedTask;
  if (process.env.DISABLE_ENRICHMENT_RECOVERY === "1") {
    // eslint-disable-next-line no-console
    console.warn(
      "[signal-backend] enrichment recovery scheduler disabled via DISABLE_ENRICHMENT_RECOVERY",
    );
    return null;
  }
  if (!cron.validate(ENRICHMENT_RECOVERY_CRON)) {
    // eslint-disable-next-line no-console
    console.error(
      `[signal-backend] invalid ENRICHMENT_RECOVERY_CRON: ${ENRICHMENT_RECOVERY_CRON}`,
    );
    return null;
  }

  cachedTask = cron.schedule(
    ENRICHMENT_RECOVERY_CRON,
    async () => {
      try {
        const result = await recoverStuckCandidates();
        // eslint-disable-next-line no-console
        console.log(
          `[signal-backend] [scheduler] enrichment recovery run: scanned=${result.scanned} reEnqueued=${result.reEnqueued} markedFailed=${result.markedFailed}`,
        );
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(
          "[signal-backend] [scheduler] enrichment recovery failed:",
          err,
        );
      }
    },
    { timezone: "UTC" },
  );

  // eslint-disable-next-line no-console
  console.log(
    `[signal-backend] enrichment recovery scheduler started (cron="${ENRICHMENT_RECOVERY_CRON}" tz=UTC)`,
  );
  return cachedTask;
}

export function stopEnrichmentRecoveryScheduler(): void {
  if (cachedTask) {
    cachedTask.stop();
    cachedTask = null;
  }
}
