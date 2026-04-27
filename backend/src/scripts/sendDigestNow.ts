import "dotenv/config";
import { sendWeeklyDigests } from "../jobs/digestJob";
import { startEmailWorker, stopEmailWorker } from "../jobs/emailWorker";
import { closeEmailQueue } from "../jobs/emailQueue";
import { closeRedis } from "../lib/redis";
import { pool } from "../db";

interface ParsedArgs {
  user?: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg === "--dry-run") {
      out.dryRun = true;
    } else if (arg.startsWith("--user=")) {
      out.user = arg.slice("--user=".length);
    } else if (arg === "--user") {
      out.user = argv[i + 1];
      i += 1;
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // eslint-disable-next-line no-console
  console.log(
    `[send-digest-now] starting${args.user ? ` (user=${args.user})` : ""}${args.dryRun ? " [dry-run]" : ""}`,
  );

  // Start the worker in-process so queued jobs actually drain.
  const worker = startEmailWorker();

  if (args.dryRun) {
    process.env.DISABLE_EMAIL_SEND = "1";
  }

  const result = await sendWeeklyDigests({ targetUserId: args.user });

  // eslint-disable-next-line no-console
  console.log(
    `[send-digest-now] enqueued=${result.enqueued} skipped=${result.skipped} window=${result.window.label}`,
  );

  if (worker) {
    // Give the worker a short grace period to drain, then shut down.
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await stopEmailWorker();
  }
  await closeEmailQueue();
  await closeRedis();
  await pool.end().catch(() => undefined);
}

main().then(
  () => process.exit(0),
  (err) => {
    // eslint-disable-next-line no-console
    console.error("[send-digest-now] failed:", err);
    process.exit(1);
  },
);
