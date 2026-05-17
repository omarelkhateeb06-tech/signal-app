import cron, { type ScheduledTask } from "node-cron";
import { sendDailyDigests } from "./digestJob";

// Phase 12i — cadence flipped from weekly to daily. The Pro-only tier
// gate happens in sendDailyDigests; the scheduler stays cadence-only.
// Default fires at 11:00 UTC (07:00 ET); override with DAILY_DIGEST_CRON
// for ops experimentation.
const DAILY_DIGEST_CRON = process.env.DAILY_DIGEST_CRON ?? "0 11 * * *";

let cachedTask: ScheduledTask | null = null;

export function startEmailScheduler(): ScheduledTask | null {
  if (cachedTask) return cachedTask;
  if (process.env.DISABLE_EMAIL_SCHEDULER === "1") {
    // eslint-disable-next-line no-console
    console.warn("[signal-backend] email scheduler disabled via DISABLE_EMAIL_SCHEDULER");
    return null;
  }
  if (!cron.validate(DAILY_DIGEST_CRON)) {
    // eslint-disable-next-line no-console
    console.error(`[signal-backend] invalid DAILY_DIGEST_CRON: ${DAILY_DIGEST_CRON}`);
    return null;
  }

  cachedTask = cron.schedule(
    DAILY_DIGEST_CRON,
    async () => {
      try {
        const result = await sendDailyDigests();
        // eslint-disable-next-line no-console
        console.log(
          `[signal-backend] [scheduler] daily digest run: enqueued=${result.enqueued} skipped=${result.skipped} failed=${result.failed} window=${result.window.label}`,
        );
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[signal-backend] [scheduler] daily digest failed:", err);
      }
    },
    { timezone: "UTC" },
  );

  // eslint-disable-next-line no-console
  console.log(
    `[signal-backend] email scheduler started (cron="${DAILY_DIGEST_CRON}" tz=UTC)`,
  );
  return cachedTask;
}

export function stopEmailScheduler(): void {
  if (cachedTask) {
    cachedTask.stop();
    cachedTask = null;
  }
}
