import "dotenv/config";
import { runAggregation } from "../jobs/aggregationJob";
import { closeRedis } from "../lib/redis";
import { pool } from "../db";

interface ParsedArgs {
  period?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg.startsWith("--period=")) {
      out.period = arg.slice("--period=".length);
    } else if (arg === "--period") {
      out.period = argv[i + 1];
      i += 1;
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // eslint-disable-next-line no-console
  console.log(
    `[run-aggregation] starting${args.period ? ` (period=${args.period})` : " (period=current week)"}`,
  );

  const result = await runAggregation({ period: args.period });

  // eslint-disable-next-line no-console
  console.log(
    `[run-aggregation] period=${result.period} processed=${result.processed}`,
  );
  for (const s of result.sectors) {
    // eslint-disable-next-line no-console
    console.log(
      `[run-aggregation]   sector=${s.sector} story_count=${s.storyCount} save_count=${s.saveCount}`,
    );
  }

  await closeRedis();
  await pool.end().catch(() => undefined);
}

main().then(
  () => process.exit(0),
  (err) => {
    // eslint-disable-next-line no-console
    console.error("[run-aggregation] failed:", err);
    process.exit(1);
  },
);
