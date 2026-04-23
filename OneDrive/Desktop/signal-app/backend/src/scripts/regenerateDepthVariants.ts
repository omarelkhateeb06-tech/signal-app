/* eslint-disable no-console */
/**
 * One-time regeneration of depth-variant `why_it_matters_template` payloads.
 *
 * Usage:
 *   npm run regenerate-depth-variants --workspace=backend
 *   npm run regenerate-depth-variants --workspace=backend -- --dry-run
 *   npm run regenerate-depth-variants --workspace=backend -- --id=<story-uuid>
 *   npm run regenerate-depth-variants --workspace=backend -- --yes
 *
 * Idempotent — overwrites any existing template. Call Haiku three times
 * per story (once per depth: accessible / standard / technical) and UPDATE
 * each row's `why_it_matters_template` with the JSON-stringified result.
 *
 * Phase 12a. Prod DB runbook lives in docs/SCHEMA.md.
 */

import "dotenv/config";
import readline from "node:readline";
import { eq } from "drizzle-orm";
import { db, pool } from "../db";
import * as schema from "../db/schema";
import {
  generateDepthVariantsForStory,
  buildAnthropicClient,
  type StoryForDepthGen,
} from "../services/depthVariantGenerator";

interface CliArgs {
  dryRun: boolean;
  yes: boolean;
  id?: string;
}

export function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { dryRun: false, yes: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--yes" || arg === "-y") out.yes = true;
    else if (arg.startsWith("--id=")) out.id = arg.slice("--id=".length);
    else if (arg === "--id") {
      const next = argv[i + 1];
      if (next) {
        out.id = next;
        i += 1;
      }
    }
  }
  return out;
}

function describeDbFromUrl(url: string | undefined): string {
  if (!url) return "<DATABASE_URL unset>";
  try {
    const u = new URL(url);
    return `${u.hostname}/${u.pathname.replace(/^\//, "") || "<no-db>"}`;
  } catch {
    return "<unparsable DATABASE_URL>";
  }
}

async function promptConfirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

type Database = typeof db;

export async function listStoriesForRegeneration(
  database: Database,
  id?: string,
): Promise<StoryForDepthGen[]> {
  const query = database
    .select({
      id: schema.stories.id,
      headline: schema.stories.headline,
      sector: schema.stories.sector,
      context: schema.stories.context,
      whyItMatters: schema.stories.whyItMatters,
    })
    .from(schema.stories);
  const rows = id ? await query.where(eq(schema.stories.id, id)) : await query;
  return rows;
}

export interface RegenerationRunSummary {
  total: number;
  succeeded: number;
  failed: { id: string; error: string }[];
}

export async function regenerateAll(
  stories: StoryForDepthGen[],
  database: Database,
  opts: {
    dryRun?: boolean;
    generate?: (s: StoryForDepthGen) => Promise<Record<string, string>>;
    onProgress?: (ctx: { idx: number; total: number; id: string }) => void;
  } = {},
): Promise<RegenerationRunSummary> {
  const summary: RegenerationRunSummary = {
    total: stories.length,
    succeeded: 0,
    failed: [],
  };
  const generate = opts.generate ?? ((s) => generateDepthVariantsForStory(s));

  for (let i = 0; i < stories.length; i += 1) {
    const story = stories[i];
    if (!story) continue;
    opts.onProgress?.({ idx: i + 1, total: stories.length, id: story.id });
    try {
      const template = await generate(story);
      if (!opts.dryRun) {
        await database
          .update(schema.stories)
          .set({
            whyItMattersTemplate: JSON.stringify(template),
            updatedAt: new Date(),
          })
          .where(eq(schema.stories.id, story.id));
      }
      summary.succeeded += 1;
    } catch (err) {
      summary.failed.push({
        id: story.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return summary;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  console.log(
    `[regenerate-depth] starting${args.dryRun ? " (dry-run)" : ""}${args.id ? ` (id=${args.id})` : ""}`,
  );

  // Eagerly validate the API key so the user gets a loud failure before
  // we SELECT from prod. `buildAnthropicClient()` throws on missing env.
  if (!args.dryRun) buildAnthropicClient();

  const stories = await listStoriesForRegeneration(db, args.id);
  console.log(`[regenerate-depth] found ${stories.length} story row(s)`);

  if (stories.length === 0) {
    console.log("[regenerate-depth] nothing to do");
    await pool.end().catch(() => undefined);
    return;
  }

  if (!args.dryRun && !args.yes) {
    const dbDesc = describeDbFromUrl(process.env.DATABASE_URL);
    const ok = await promptConfirm(
      `Regenerate depth variants for ${stories.length} stories against ${dbDesc}? (y/n) `,
    );
    if (!ok) {
      console.log("[regenerate-depth] aborted by user");
      await pool.end().catch(() => undefined);
      return;
    }
  }

  const result = await regenerateAll(stories, db, {
    dryRun: args.dryRun,
    onProgress: ({ idx, total, id }) =>
      console.log(`[regenerate-depth] ${idx}/${total} id=${id}`),
  });

  console.log(
    `[regenerate-depth] done total=${result.total} succeeded=${result.succeeded} failed=${result.failed.length}${args.dryRun ? " [dry-run]" : ""}`,
  );
  for (const f of result.failed) {
    console.error(`[regenerate-depth]   FAIL id=${f.id} err=${f.error}`);
  }

  await pool.end().catch(() => undefined);
  process.exit(result.failed.length > 0 ? 1 : 0);
}

if (require.main === module) {
  void main().catch((err: unknown) => {
    console.error("[regenerate-depth] fatal:", err);
    process.exit(1);
  });
}
