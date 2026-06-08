// Phase 12s — apply editorial illustrations to existing native events.
//
// Reads backend/scripts/illustration-manifest.json (produced by the
// illustration-generation session) and writes each entry's URL into
// events.illustration_url. The UPDATE is guarded on source_type =
// 'native' so a stray non-native id in the manifest can never touch an
// ingested row.
//
// SAFETY: dry-run is the DEFAULT. The script prints what it would do and
// exits without writing unless you pass --apply. This is deliberate — the
// manifest is reviewed before any prod write (see CLAUDE.md §6 "Manual
// prod SQL"). Re-runs are idempotent: the UPDATE simply sets the same URL.
//
// CLI:
//   npm run apply-illustrations                 # dry-run (default)
//   npm run apply-illustrations -- --apply      # perform the writes
//   npm run apply-illustrations -- --manifest=/abs/path/to/file.json
//
// Resolution of the default manifest path: <repo>/backend/scripts/
// illustration-manifest.json, resolved relative to this file so it works
// regardless of the process CWD.

import "../lib/loadEnv";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db, pool } from "../db";
import { events } from "../db/schema";

const ManifestEntrySchema = z.object({
  eventId: z.string().uuid(),
  // The remaining fields are informational (kept in the manifest for
  // human review); only eventId + illustrationUrl drive the UPDATE.
  headline: z.string().optional(),
  generatorType: z.string().nullable().optional(),
  sector: z.string().optional(),
  illustrationUrl: z.string().url(),
});

const ManifestSchema = z.array(ManifestEntrySchema);

type ManifestEntry = z.infer<typeof ManifestEntrySchema>;

interface Args {
  apply: boolean;
  manifestPath: string;
}

function parseArgs(argv: readonly string[]): Args {
  const apply = argv.includes("--apply");
  let manifestPath = resolve(__dirname, "../../scripts/illustration-manifest.json");
  for (const arg of argv) {
    const m = /^--manifest=(.+)$/.exec(arg);
    if (m && m[1]) manifestPath = resolve(m[1]);
  }
  return { apply, manifestPath };
}

function loadManifest(path: string): ManifestEntry[] {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    throw new Error(
      `Could not read manifest at ${path}: ${(err as Error).message}`,
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Manifest at ${path} is not valid JSON: ${(err as Error).message}`);
  }
  return ManifestSchema.parse(json);
}

interface ApplyStats {
  total: number;
  updated: number;
  skippedNotNative: number;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const entries = loadManifest(args.manifestPath);

  // eslint-disable-next-line no-console
  console.log(
    `[apply-illustrations] manifest=${args.manifestPath} entries=${entries.length} mode=${args.apply ? "APPLY" : "DRY-RUN"}`,
  );

  const stats: ApplyStats = { total: entries.length, updated: 0, skippedNotNative: 0 };

  for (const entry of entries) {
    if (!args.apply) {
      // eslint-disable-next-line no-console
      console.log(
        `[apply-illustrations][dry-run] would set illustration_url for event=${entry.eventId} -> ${entry.illustrationUrl}`,
      );
      continue;
    }

    // Guard on source_type = 'native': returning() tells us whether a row
    // actually matched. A non-native or unknown id matches zero rows.
    const updatedRows = await db
      .update(events)
      .set({ illustrationUrl: entry.illustrationUrl, updatedAt: new Date() })
      .where(and(eq(events.id, entry.eventId), eq(events.sourceType, "native")))
      .returning({ id: events.id });

    if (updatedRows.length > 0) {
      stats.updated += 1;
      // eslint-disable-next-line no-console
      console.log(
        `[apply-illustrations] updated event=${entry.eventId} -> ${entry.illustrationUrl}`,
      );
    } else {
      stats.skippedNotNative += 1;
      // eslint-disable-next-line no-console
      console.warn(
        `[apply-illustrations] SKIP event=${entry.eventId} — no native row matched (not found or source_type != 'native')`,
      );
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    `[apply-illustrations] DONE total=${stats.total} updated=${stats.updated} skipped=${stats.skippedNotNative}${args.apply ? "" : " (dry-run — no writes)"}`,
  );

  await pool.end();
  process.exit(0);
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[apply-illustrations] FAILED", err);
    process.exit(1);
  });
}
