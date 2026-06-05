import cron, { type ScheduledTask } from "node-cron";
import { runNativeGeneration, NATIVE_DAILY_CAP } from "../services/nativeGenerationService";

// Phase 12u — recurring native-post generation.
//
// Native posts were authored only by the manual scripts/runNativeGeneration.ts
// CLI, so when nobody ran it the feed's "Originals" band and /archive went
// stale (posts aged out). This scheduler fans out across every registered
// native generator once a day, sharing the global NATIVE_DAILY_CAP budget.
//
// Mirrors emailScheduler.ts: a thin node-cron wrapper, cadence-only, with an
// env-overridable cron and a disable flag for local dev. The generation core
// (cap accounting, persist + enrich) lives in nativeGenerationService.
//
// Default fires at 09:00 UTC, offset from the 11:00 digest cron so the two
// daily jobs don't contend; override with NATIVE_GENERATION_CRON.
const NATIVE_GENERATION_CRON = process.env.NATIVE_GENERATION_CRON ?? "0 9 * * *";

let cachedTask: ScheduledTask | null = null;

export function startNativeGenerationScheduler(): ScheduledTask | null {
  if (cachedTask) return cachedTask;
  if (process.env.DISABLE_NATIVE_SCHEDULER === "1") {
    // eslint-disable-next-line no-console
    console.warn(
      "[signal-backend] native generation scheduler disabled via DISABLE_NATIVE_SCHEDULER",
    );
    return null;
  }
  if (!cron.validate(NATIVE_GENERATION_CRON)) {
    // eslint-disable-next-line no-console
    console.error(
      `[signal-backend] invalid NATIVE_GENERATION_CRON: ${NATIVE_GENERATION_CRON}`,
    );
    return null;
  }

  cachedTask = cron.schedule(
    NATIVE_GENERATION_CRON,
    async () => {
      // ANTHROPIC_API_KEY is the only hard dependency: generators author post
      // bodies via Haiku, and the facts/tier seams need it too. Without it a
      // run authors zero candidates and churns the DB for nothing — skip it.
      // (Redis is not on the native path; it writes straight to Postgres.)
      const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
      if (!apiKey) {
        // eslint-disable-next-line no-console
        console.warn(
          "[signal-backend] [scheduler] native generation skipped — ANTHROPIC_API_KEY not set",
        );
        return;
      }
      try {
        const result = await runNativeGeneration();
        // eslint-disable-next-line no-console
        console.log(
          `[signal-backend] [scheduler] native generation run: ` +
            `generators=${result.generatorsRun} authored=${result.candidatesAuthored} ` +
            `published=${result.published} cap=${result.cap.used}/${NATIVE_DAILY_CAP} ` +
            `exhausted=${result.capExhausted}`,
        );
      } catch (err) {
        // A generation failure must never crash the scheduler — log and let
        // the next cadence retry.
        // eslint-disable-next-line no-console
        console.error("[signal-backend] [scheduler] native generation failed:", err);
      }
    },
    { timezone: "UTC" },
  );

  // eslint-disable-next-line no-console
  console.log(
    `[signal-backend] native generation scheduler started (cron="${NATIVE_GENERATION_CRON}" tz=UTC)`,
  );
  return cachedTask;
}

export function stopNativeGenerationScheduler(): void {
  if (cachedTask) {
    cachedTask.stop();
    cachedTask = null;
  }
}
