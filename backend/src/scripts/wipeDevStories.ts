/* eslint-disable no-console */
/**
 * Wipe dev `stories` and `writers` tables so the reseed from current
 * `seed-data/stories.json` runs against an empty slate.
 *
 * Usage:
 *   npm run wipe:dev-stories --workspace=backend -- --dry-run
 *   npm run wipe:dev-stories --workspace=backend
 *
 * Safety:
 *   - Refuses to run unless DATABASE_URL hostname contains "neon.tech"
 *     (our dev DB). Prod on Railway is explicitly excluded. The only
 *     bypass is `--force-prod` plus the typed confirmation string
 *     "I UNDERSTAND THIS IS PROD" at the prompt; intended as a
 *     documented guardrail, not a day-to-day option.
 *   - Delete order (single transaction):
 *       1. stories — cascades to commentary_cache, comments, user_saves,
 *          learning_path_stories via existing FKs.
 *       2. writers — safe because stories.author_id is ON DELETE SET NULL
 *          and all rows were just removed.
 *   - `--dry-run` reports current row counts and exits without writing.
 *
 * Exit codes: 0 on success or dry-run, 1 on validation/DB failure.
 */

import "dotenv/config";
import readline from "node:readline";
import { sql } from "drizzle-orm";
import { db, pool } from "../db";
import * as schema from "../db/schema";

interface CliArgs {
  dryRun: boolean;
  forceProd: boolean;
}

export function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { dryRun: false, forceProd: false };
  for (const arg of argv) {
    if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--force-prod") out.forceProd = true;
  }
  return out;
}

function log(msg: string): void {
  console.log(`[wipe] ${msg}`);
}

function describeDbFromUrl(url: string | undefined): { host: string; db: string } {
  if (!url) return { host: "<unset>", db: "<unset>" };
  try {
    const u = new URL(url);
    return { host: u.hostname, db: u.pathname.replace(/^\//, "") || "<no-db>" };
  } catch {
    return { host: "<unparsable>", db: "<unparsable>" };
  }
}

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function getCounts(): Promise<{ stories: number; writers: number }> {
  const s = await db.execute<{ count: string }>(sql`SELECT COUNT(*)::text AS count FROM stories`);
  const w = await db.execute<{ count: string }>(sql`SELECT COUNT(*)::text AS count FROM writers`);
  return {
    stories: Number(s.rows[0]?.count ?? "0"),
    writers: Number(w.rows[0]?.count ?? "0"),
  };
}

export async function run(args: CliArgs): Promise<void> {
  const dbInfo = describeDbFromUrl(process.env.DATABASE_URL);
  log(`target: ${dbInfo.host}/${dbInfo.db}`);

  const isNeon = dbInfo.host.includes("neon.tech");
  if (!isNeon) {
    if (!args.forceProd) {
      log(`refusing to run: hostname "${dbInfo.host}" does not contain "neon.tech"`);
      log(`this script is dev-only. bypass requires --force-prod and a typed confirmation.`);
      throw new Error("non-dev database target");
    }
    const typed = await prompt(
      `DANGER: you passed --force-prod against ${dbInfo.host}/${dbInfo.db}.\n` +
        `Type exactly: I UNDERSTAND THIS IS PROD\n> `,
    );
    if (typed !== "I UNDERSTAND THIS IS PROD") {
      log("confirmation mismatch — aborting");
      throw new Error("prod confirmation failed");
    }
  }

  log("counting existing rows...");
  const before = await getCounts();
  log(`  stories: ${before.stories}`);
  log(`  writers: ${before.writers}`);

  if (args.dryRun) {
    log(`dry-run — would DELETE ${before.stories} stories (cascading) then ${before.writers} writers`);
    log("done (dry-run)");
    return;
  }

  if (before.stories === 0 && before.writers === 0) {
    log("both tables already empty — nothing to do");
    return;
  }

  const confirmMsg =
    `Will DELETE ALL rows from stories (${before.stories}) and writers (${before.writers}) ` +
    `on ${dbInfo.host}/${dbInfo.db}. ` +
    `Cascades will also clear commentary_cache, comments, user_saves, learning_path_stories rows ` +
    `referencing these stories. Proceed? (y/n) `;
  const answer = await prompt(confirmMsg);
  if (answer.trim().toLowerCase() !== "y") {
    log("aborted by user");
    return;
  }

  log("deleting in transaction...");
  let deletedStories = 0;
  let deletedWriters = 0;
  await db.transaction(async (tx) => {
    const s = await tx.delete(schema.stories).returning({ id: schema.stories.id });
    deletedStories = s.length;
    const w = await tx.delete(schema.writers).returning({ id: schema.writers.id });
    deletedWriters = w.length;
  });

  log(`deleted ${deletedStories} stories and ${deletedWriters} writers`);
  const after = await getCounts();
  log(`  stories: ${after.stories}`);
  log(`  writers: ${after.writers}`);
  log("done");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  let exitCode = 0;
  try {
    await run(args);
  } catch (err) {
    exitCode = 1;
    console.error("[wipe] error:", err instanceof Error ? err.message : err);
  } finally {
    try {
      await pool.end();
    } catch {
      /* ignore */
    }
  }
  process.exit(exitCode);
}

if (require.main === module) {
  void main();
}
