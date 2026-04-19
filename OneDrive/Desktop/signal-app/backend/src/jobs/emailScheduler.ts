import cron, { type ScheduledTask } from "node-cron";
import { sendWeeklyDigests } from "./digestJob";

const WEEKLY_DIGEST_CRON = process.env.WEEKLY_DIGEST_CRON ?? "0 8 * * 1";

let cachedTask: ScheduledTask | null = null;

export function startEmailScheduler(): ScheduledTask | null {
  if (cachedTask) return cachedTask;
  if (process.env.DISABLE_EMAIL_SCHEDULER === "1") {
    // eslint-disable-next-line no-console
    console.warn("[signal-backend] email scheduler disabled via DISABLE_EMAIL_SCHEDULER");
    return null;
  }
  if (!cron.validate(WEEKLY_DIGEST_CRON)) {
    // eslint-disable-next-line no-console
    console.error(`[signal-backend] invalid WEEKLY_DIGEST_CRON: ${WEEKLY_DIGEST_CRON}`);
    return null;
  }

  cachedTask = cron.schedule(
    WEEKLY_DIGEST_CRON,
    async () => {
      try {
        const result = await sendWeeklyDigests();
        // eslint-disable-next-line no-console
        console.log(
          `[signal-backend] [scheduler] weekly digest run: enqueued=${result.enqueued} skipped=${result.skipped}`,
        );
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[signal-backend] [scheduler] weekly digest failed:", err);
      }
    },
    { timezone: "UTC" },
  );

  // eslint-disable-next-line no-console
  console.log(
    `[signal-backend] email scheduler started (cron="${WEEKLY_DIGEST_CRON}" tz=UTC)`,
  );
  return cachedTask;
}

export function stopEmailScheduler(): void {
  if (cachedTask) {
    cachedTask.stop();
    cachedTask = null;
  }
}
