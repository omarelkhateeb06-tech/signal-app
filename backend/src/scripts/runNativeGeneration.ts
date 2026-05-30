// Phase 12n.2 — manual trigger for native-post generation.
//
// Bypasses BullMQ. Runs a native generator end-to-end without Redis:
//   1. Resolve the native source row by slug.
//   2. Run the generator → NativeCandidate[] (authors post bodies via
//      Haiku from public GitHub API metadata only — no scraping).
//   3. Insert each as an ingestion_candidates row carrying sector +
//      bodyText + rawPublishedAt=now(). Dedup via the
//      (ingestion_source_id, external_id) unique constraint.
//   4. Push each candidate through processNativeEnrichment (facts → tiers
//      → writeEvent), skipping relevance/cluster by construction.
//
// Requires ANTHROPIC_API_KEY for the generator's authoring step + the
// facts/tier seams. GITHUB_TOKEN is optional (lifts the search rate
// limit). With neither key the generator returns zero candidates and the
// seams return *_NO_API_KEY — graceful degradation, not a crash.
//
// Usage:
//   npm run run-native-generation --workspace=backend
//   npm run run-native-generation --workspace=backend -- --slug=github-trending-native
//   npm run run-native-generation --workspace=backend -- --dry-run
//
// --dry-run authors the posts and prints them but skips both the candidate
// insert and enrichment — the sanctioned way to eyeball generation quality
// on real trending repos before writing anything.
//
// Shutdown: clean teardown via try/finally. No process.exit(0) — see
// followup #47 (Node-on-Windows libuv shutdown crash). On fatal error,
// set process.exitCode = 1 and let the event loop drain naturally.

import "dotenv/config";
import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";

import { db, pool } from "../db";
import { ingestionCandidates, ingestionSources } from "../db/schema";
import { getGenerator } from "../jobs/ingestion/generators";
import type { NativeCandidate } from "../jobs/ingestion/generators/types";
import { processNativeEnrichment } from "../jobs/ingestion/nativeEnrichmentJob";

const DEFAULT_SLUG = "github-trending-native";

interface ParsedArgs {
  slug: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  let slug = DEFAULT_SLUG;
  let dryRun = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg.startsWith("--slug=")) slug = arg.slice("--slug=".length);
    else if (arg === "--slug") {
      slug = argv[i + 1] ?? slug;
      i += 1;
    } else if (arg === "--dry-run") dryRun = true;
  }
  return { slug, dryRun };
}

function sha256Truncated(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex").slice(0, 32);
}

function printCandidate(index: number, c: NativeCandidate): void {
  /* eslint-disable no-console */
  console.log(`\n──────── native post #${index + 1} ────────`);
  console.log(`external_id: ${c.externalId}`);
  console.log(`url:         ${c.url}`);
  console.log(`sector:      ${c.sector}`);
  console.log(`headline:    ${c.headline}`);
  console.log(`body:\n${c.body}`);
  /* eslint-enable no-console */
}

// Insert one native candidate. Returns the row id (the freshly-inserted
// id, or the existing row's id on conflict — re-running the generator
// over the same trending repo is a no-op insert that still resolves to
// the prior candidate so enrichment can short-circuit on its status).
async function upsertCandidate(
  sourceId: string,
  c: NativeCandidate,
  now: Date,
): Promise<string> {
  const inserted = await db
    .insert(ingestionCandidates)
    .values({
      ingestionSourceId: sourceId,
      externalId: c.externalId,
      url: c.url,
      rawTitle: c.headline,
      rawSummary: c.summary ?? null,
      rawPublishedAt: now,
      rawPayload: c.rawPayload,
      contentHash: sha256Truncated(`${c.url}\n${c.headline}`),
      bodyText: c.body,
      sector: c.sector,
    })
    .onConflictDoNothing({
      target: [
        ingestionCandidates.ingestionSourceId,
        ingestionCandidates.externalId,
      ],
    })
    .returning({ id: ingestionCandidates.id });

  if (inserted[0]) return inserted[0].id;

  const existing = await db
    .select({ id: ingestionCandidates.id })
    .from(ingestionCandidates)
    .where(
      and(
        eq(ingestionCandidates.ingestionSourceId, sourceId),
        eq(ingestionCandidates.externalId, c.externalId),
      ),
    )
    .limit(1);
  if (!existing[0]) {
    throw new Error(`candidate vanished after conflict: ${c.externalId}`);
  }
  return existing[0].id;
}

async function main(): Promise<void> {
  try {
    const args = parseArgs(process.argv.slice(2));
    /* eslint-disable no-console */
    console.log(
      `[run-native-generation] starting (slug=${args.slug}, dry-run=${args.dryRun})`,
    );

    const generator = getGenerator(args.slug);
    if (!generator) {
      throw new Error(
        `no generator registered for slug=${args.slug} (see generators/index.ts)`,
      );
    }

    const sourceRows = await db
      .select({ id: ingestionSources.id, enabled: ingestionSources.enabled })
      .from(ingestionSources)
      .where(eq(ingestionSources.slug, args.slug))
      .limit(1);
    const source = sourceRows[0];
    if (!source) {
      throw new Error(
        `source row not found: slug=${args.slug} (apply migration 0037)`,
      );
    }

    const now = new Date();
    const candidates = await generator.generate({ now: () => now });
    console.log(
      `[run-native-generation] generator authored ${candidates.length} candidate(s)`,
    );

    candidates.forEach((c, i) => printCandidate(i, c));

    if (args.dryRun) {
      console.log("\n[run-native-generation] dry-run — no inserts, no enrichment.");
      return;
    }

    console.log("\n[run-native-generation] persisting + enriching…");
    const summary: Record<string, number> = {};
    for (const c of candidates) {
      const candidateId = await upsertCandidate(source.id, c, now);
      const result = await processNativeEnrichment({
        candidateId,
        triggeredBy: "cli",
      });
      summary[result.terminalStatus] =
        (summary[result.terminalStatus] ?? 0) + 1;
      console.log(
        `[run-native-generation]   ${c.externalId} -> candidate=${candidateId} -> ${result.terminalStatus}` +
          `${result.failureReason ? ` (${result.failureReason})` : ""}` +
          `${result.resolvedEventId ? ` event=${result.resolvedEventId}` : ""}`,
      );
    }

    console.log(
      "[run-native-generation] summary:",
      JSON.stringify(summary, null, 2),
    );
    /* eslint-enable no-console */
  } finally {
    await pool.end().catch(() => undefined);
  }
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(
      "[run-native-generation] fatal:",
      err instanceof Error ? err.message : err,
    );
    process.exitCode = 1;
  });
}
