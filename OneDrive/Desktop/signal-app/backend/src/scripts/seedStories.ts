/* eslint-disable no-console */
/**
 * Seed the production `stories` table from a hand-curated JSON file.
 *
 * Usage:
 *   npm run seed:stories --workspace=backend           # default path
 *   npm run seed:stories --workspace=backend -- --dry-run
 *   npm run seed:stories --workspace=backend -- --file=<path>
 *   npm run seed:stories --workspace=backend -- --yes   # skip confirm (CI only)
 *
 * Default file: <backend>/seed-data/stories.json
 *
 * Behavior:
 *   - Validates the whole file with Zod (per-item errors on failure).
 *   - Resolves string `author_id` placeholders (e.g. "SIGNAL_EDITORIAL") to
 *     real writer UUIDs by upserting each entry in `writers_seed`.
 *   - Writer upsert strategy: SELECT-by-name, INSERT-if-absent. `writers` has
 *     no unique column we can match against here (email is unique but seed
 *     data has no email), so this races under concurrent writers — fine for
 *     a manually-operated prod seeder with explicit confirmation.
 *   - Story idempotency: pre-SELECT by `source_url` (no unique index exists
 *     on that column), partition into insert/skip, then insert.
 *   - Prints a dry-run-style summary with DATABASE_URL host/dbname and waits
 *     for an explicit `y` before writing (unless --yes is passed).
 *
 * Exit codes: 0 on success or clean no-op re-run, non-zero on validation or
 * DB failure.
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, pool } from "../db";
import * as schema from "../db/schema";

const SECTORS = ["ai", "finance", "semiconductors"] as const;
type Sector = (typeof SECTORS)[number];

// ---------- Schemas ----------

const WriterSeedSchema = z
  .object({
    placeholder_id: z.string().min(1),
    name: z.string().min(1).max(255),
    // `slug` is accepted but has no column in the current writers schema —
    // silently dropped at insert time. See completion log for details.
    slug: z.string().optional(),
    bio: z.string().optional(),
  })
  .passthrough();

// Depth-variant commentary (Phase 12a). The pre-12a shape (sector keys ai
// / finance / semiconductors) is intentionally rejected here — if the seed
// file still has legacy content, run the regeneration script to repopulate
// the DB and update the JSON separately. `.strict()` catches lingering
// legacy keys loudly.
const WhyItMattersTemplateSchema = z
  .object({
    accessible: z.string().min(1),
    standard: z.string().min(1),
    technical: z.string().min(1),
  })
  .strict();

const StorySeedSchema = z.object({
  sector: z.enum(SECTORS),
  headline: z.string().min(1).max(255),
  context: z.string().min(1),
  why_it_matters: z.string().min(1),
  why_it_matters_template: WhyItMattersTemplateSchema,
  source_url: z.string().url(),
  source_name: z.string().min(1).max(255).optional(),
  author_id: z.string().min(1),
  published_at: z.string().datetime({ offset: true }),
});

const SeedFileSchema = z.object({
  writers_seed: z.array(WriterSeedSchema).min(1),
  stories: z.array(StorySeedSchema).min(1),
});

export type SeedFile = z.infer<typeof SeedFileSchema>;
export type StorySeed = z.infer<typeof StorySeedSchema>;
export type WriterSeed = z.infer<typeof WriterSeedSchema>;

// ---------- Validation ----------

export class SeedValidationError extends Error {
  public readonly issues: string[];
  constructor(issues: string[]) {
    super(`Seed validation failed:\n- ${issues.join("\n- ")}`);
    this.name = "SeedValidationError";
    this.issues = issues;
  }
}

interface RawShape {
  stories?: Array<{ headline?: unknown } | undefined>;
  writers_seed?: Array<{ placeholder_id?: unknown; name?: unknown } | undefined>;
}

function identifyIssue(raw: unknown, issuePath: Array<string | number>): string {
  const first = issuePath[0];
  const idx = issuePath[1];
  if (typeof idx !== "number") return "";
  const r = raw as RawShape | undefined;
  if (first === "stories") {
    const story = r?.stories?.[idx];
    const headline = typeof story?.headline === "string" ? story.headline : "";
    const snippet = headline ? ` headline: "${headline.slice(0, 60)}${headline.length > 60 ? "..." : ""}"` : "";
    return ` (story ${idx + 1}${snippet ? "," : ""}${snippet})`;
  }
  if (first === "writers_seed") {
    const w = r?.writers_seed?.[idx];
    const pid = typeof w?.placeholder_id === "string" ? w.placeholder_id : "";
    return ` (writers_seed ${idx + 1}${pid ? `, placeholder_id: ${pid}` : ""})`;
  }
  return "";
}

export function validateSeedFile(raw: unknown): SeedFile {
  const result = SeedFileSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((iss) => {
      const pathStr = iss.path.join(".");
      const hint = identifyIssue(raw, iss.path as Array<string | number>);
      return `${pathStr || "<root>"}${hint}: ${iss.message}`;
    });
    throw new SeedValidationError(issues);
  }

  // Cross-field: every author_id must resolve to a writers_seed placeholder.
  const placeholders = new Set(result.data.writers_seed.map((w) => w.placeholder_id));
  const crossIssues: string[] = [];
  result.data.stories.forEach((s, i) => {
    if (!placeholders.has(s.author_id)) {
      crossIssues.push(
        `stories.${i}.author_id (story ${i + 1}, headline: "${s.headline.slice(0, 60)}${s.headline.length > 60 ? "..." : ""}"): author_id "${s.author_id}" not found in writers_seed`,
      );
    }
  });
  if (crossIssues.length > 0) throw new SeedValidationError(crossIssues);

  return result.data;
}

// ---------- Writer upsert ----------

type Database = typeof db;

export interface WriterUpsertResult {
  id: string;
  created: boolean;
}

export async function upsertWriter(
  database: Database,
  w: WriterSeed,
): Promise<WriterUpsertResult> {
  const existing = await database
    .select({ id: schema.writers.id })
    .from(schema.writers)
    .where(eq(schema.writers.name, w.name))
    .limit(1);
  const first = existing[0];
  if (first) {
    return { id: first.id, created: false };
  }
  const inserted = await database
    .insert(schema.writers)
    .values({
      name: w.name,
      bio: w.bio,
      // `slug` from the JSON is intentionally dropped — there's no matching
      // column in the writers schema today.
    })
    .returning({ id: schema.writers.id });
  const newRow = inserted[0];
  if (!newRow) {
    throw new Error(`Writer upsert returned no rows for "${w.name}"`);
  }
  return { id: newRow.id, created: true };
}

export interface WriterUpsertDetail {
  placeholder: string;
  name: string;
  id: string;
  created: boolean;
}

export interface PlaceholderMapResult {
  map: Map<string, string>;
  created: number;
  matched: number;
  details: WriterUpsertDetail[];
}

export async function buildPlaceholderMap(
  database: Database,
  writers: WriterSeed[],
): Promise<PlaceholderMapResult> {
  const map = new Map<string, string>();
  const details: WriterUpsertDetail[] = [];
  let created = 0;
  let matched = 0;
  for (const w of writers) {
    const result = await upsertWriter(database, w);
    map.set(w.placeholder_id, result.id);
    if (result.created) created += 1;
    else matched += 1;
    details.push({ placeholder: w.placeholder_id, name: w.name, id: result.id, created: result.created });
  }
  return { map, created, matched, details };
}

// ---------- Story idempotency ----------

export interface PartitionResult {
  toInsert: StorySeed[];
  toSkip: StorySeed[];
}

export async function partitionStoriesByExistence(
  database: Database,
  stories: StorySeed[],
): Promise<PartitionResult> {
  if (stories.length === 0) return { toInsert: [], toSkip: [] };
  const urls = stories.map((s) => s.source_url);
  const rows = await database
    .select({ sourceUrl: schema.stories.sourceUrl })
    .from(schema.stories)
    .where(inArray(schema.stories.sourceUrl, urls));
  const existing = new Set(rows.map((r) => r.sourceUrl));
  const toInsert: StorySeed[] = [];
  const toSkip: StorySeed[] = [];
  for (const s of stories) {
    if (existing.has(s.source_url)) toSkip.push(s);
    else toInsert.push(s);
  }
  return { toInsert, toSkip };
}

export interface InsertOptions {
  onProgress?: (inserted: number, total: number) => void;
}

export async function insertStoryBatch(
  database: Database,
  stories: StorySeed[],
  authorMap: Map<string, string>,
  opts: InsertOptions = {},
): Promise<number> {
  let inserted = 0;
  for (const s of stories) {
    const authorId = authorMap.get(s.author_id);
    if (!authorId) {
      throw new Error(
        `Unknown author_id "${s.author_id}" (should have been caught in validation)`,
      );
    }
    await database.insert(schema.stories).values({
      sector: s.sector,
      headline: s.headline,
      context: s.context,
      whyItMatters: s.why_it_matters,
      // `why_it_matters_template` column is TEXT, not JSONB — stringify.
      whyItMattersTemplate: JSON.stringify(s.why_it_matters_template),
      sourceUrl: s.source_url,
      sourceName: s.source_name,
      authorId,
      publishedAt: new Date(s.published_at),
    });
    inserted += 1;
    if (opts.onProgress && inserted % 5 === 0) opts.onProgress(inserted, stories.length);
  }
  return inserted;
}

// ---------- CLI plumbing ----------

function describeDbFromUrl(url: string | undefined): string {
  if (!url) return "<DATABASE_URL unset>";
  try {
    const u = new URL(url);
    const dbname = u.pathname.replace(/^\//, "") || "<no-db>";
    return `${u.hostname}/${dbname}`;
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

interface CliArgs {
  dryRun: boolean;
  yes: boolean;
  file: string;
}

export function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    dryRun: false,
    yes: false,
    file: path.resolve(process.cwd(), "seed-data/stories.json"),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === "--dry-run") {
      out.dryRun = true;
    } else if (arg === "--yes" || arg === "-y") {
      out.yes = true;
    } else if (arg.startsWith("--file=")) {
      out.file = path.resolve(arg.slice("--file=".length));
    } else if (arg === "--file") {
      const next = argv[i + 1];
      if (next) {
        out.file = path.resolve(next);
        i += 1;
      }
    }
  }
  return out;
}

function log(msg: string): void {
  console.log(`[seed] ${msg}`);
}

export async function run(args: CliArgs): Promise<void> {
  log(`starting${args.dryRun ? " (dry-run)" : ""}`);
  log(`reading ${args.file}`);

  const raw: unknown = JSON.parse(fs.readFileSync(args.file, "utf-8"));
  log("validating...");
  const data = validateSeedFile(raw);
  log(`validated: ${data.writers_seed.length} writer(s), ${data.stories.length} stories`);

  log("resolving writers...");
  const { map, created, matched, details } = await buildPlaceholderMap(db, data.writers_seed);
  for (const d of details) {
    log(
      `  writer ${d.created ? "inserted" : "matched "} placeholder=${d.placeholder} name="${d.name}" id=${d.id}`,
    );
  }

  log("checking existing stories by source_url...");
  const { toInsert, toSkip } = await partitionStoriesByExistence(db, data.stories);
  log(`plan: ${toInsert.length} to insert, ${toSkip.length} already present (will skip)`);

  if (args.dryRun) {
    log("dry-run — no writes will be performed");
    if (toInsert.length > 0) {
      log("sample of stories that would be inserted (up to 3):");
      toInsert.slice(0, 3).forEach((s, i) => {
        log(`  ${i + 1}. [${s.sector}] ${s.headline}`);
      });
    }
    log("done (dry-run)");
    return;
  }

  const dbDesc = describeDbFromUrl(process.env.DATABASE_URL);
  const summary =
    `Will upsert ${data.writers_seed.length} writer(s) (created: ${created}, matched: ${matched}), ` +
    `insert ${toInsert.length} stories (${toSkip.length} already exist and will be skipped). ` +
    `Database: ${dbDesc}. Proceed? (y/n) `;

  const confirmed = args.yes ? true : await promptConfirm(summary);
  if (!confirmed) {
    log("aborted by user");
    return;
  }

  let insertedStories = 0;
  if (toInsert.length > 0) {
    log(`inserting ${toInsert.length} stories...`);
    insertedStories = await insertStoryBatch(db, toInsert, map, {
      onProgress: (n, total) => log(`  progress ${n}/${total}`),
    });
  }

  log(
    `done: writers (${created} created, ${matched} matched), ` +
      `stories (${insertedStories} inserted, ${toSkip.length} skipped)`,
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  let exitCode = 0;
  try {
    await run(args);
  } catch (err) {
    exitCode = 1;
    if (err instanceof SeedValidationError) {
      console.error("[seed] validation failed:");
      for (const issue of err.issues) console.error(`  - ${issue}`);
    } else {
      console.error("[seed] error:", err instanceof Error ? err.message : err);
    }
  } finally {
    try {
      await pool.end();
    } catch {
      /* ignore — may be a mocked pool in tests */
    }
  }
  process.exit(exitCode);
}

// Only run when executed directly (not imported by tests).
if (require.main === module) {
  void main();
}

// Unused type export kept so downstream consumers/IDE can reference the
// narrowed sector literal without re-deriving it.
export type { Sector };
