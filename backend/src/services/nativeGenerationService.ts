// Phase 12u — reusable native-post generation core.
//
// Factored out of scripts/runNativeGeneration.ts so the same logic can be
// driven by BOTH the manual CLI (one slug, verbose diagnostics) and the
// recurring scheduler (jobs/nativeGenerationScheduler.ts — all registered
// generators, quiet). Generation behavior and the global daily cap are
// unchanged; this module only extracts the persist-and-enrich loop the CLI
// already ran inline.
//
// The native path deliberately does NOT use Redis/BullMQ — generators author
// post bodies via Haiku from public APIs and write straight to Postgres
// through processNativeEnrichment (facts → tiers → writeEvent). The only hard
// external dependency is ANTHROPIC_API_KEY; without it generators return zero
// candidates and the enrichment seams short-circuit (*_NO_API_KEY), so the
// caller can cheaply skip the whole run.

import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";

import { db } from "../db";
import { ingestionCandidates, ingestionSources } from "../db/schema";
import { getGenerator, listGenerators } from "../jobs/ingestion/generators";
import {
  applyDailyCap,
  checkDailyCap,
  NATIVE_DAILY_CAP,
} from "../jobs/ingestion/generators/dailyCap";
import type {
  NativeCandidate,
  NativeGenerator,
} from "../jobs/ingestion/generators/types";
import { processNativeEnrichment } from "../jobs/ingestion/nativeEnrichmentJob";

export interface NativeGenerationRunResult {
  // Number of generators that ran (skipped slugs without a source row are
  // excluded). Zero when the cap was already exhausted before any ran.
  generatorsRun: number;
  // Candidates authored across all generators, after the daily-cap truncation.
  candidatesAuthored: number;
  // Candidates that reached `published` (a fresh native event).
  published: number;
  // Tally of every terminal enrichment status, for log/observability.
  statusCounts: Record<string, number>;
  // Whether the global daily cap was already exhausted at run start.
  capExhausted: boolean;
  // The daily-cap snapshot read at run start.
  cap: { used: number; remaining: number };
}

export function sha256Truncated(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex").slice(0, 32);
}

// Insert one native candidate. Returns the row id (the freshly-inserted id, or
// the existing row's id on conflict). Lifted verbatim from the CLI so the
// dedup-on-(source,external_id) semantics are identical.
export async function upsertCandidate(
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

// Resolve the enabled ingestion_sources row for a generator's slug. Returns
// null when the source row is missing (seed migration not applied) — the
// caller skips that generator rather than throwing, so one un-seeded slug
// can't take the whole scheduled run down.
async function resolveSourceId(slug: string): Promise<string | null> {
  const rows = await db
    .select({ id: ingestionSources.id })
    .from(ingestionSources)
    .where(eq(ingestionSources.slug, slug))
    .limit(1);
  return rows[0]?.id ?? null;
}

export interface RunNativeGenerationOptions {
  // Which generators to run. Defaults to every registered generator (the
  // scheduler's behavior); the CLI passes a single slug.
  slugs?: string[];
  // Injectable clock for deterministic tests.
  now?: Date;
}

// Run native generation end-to-end for the given generators, sharing one
// global daily-cap budget (read once from the DB at the top). Persists +
// enriches each authored candidate. Returns an aggregate result for logging.
//
// Mirrors the CLI's persist/enrich loop exactly — the only differences are
// that it can fan out across multiple generators and emits no per-repo
// diagnostics (production generation passes no onDiagnostic sink).
export async function runNativeGeneration(
  options: RunNativeGenerationOptions = {},
): Promise<NativeGenerationRunResult> {
  const now = options.now ?? new Date();

  const generators: NativeGenerator[] = options.slugs
    ? options.slugs
        .map((slug) => getGenerator(slug))
        .filter((g): g is NativeGenerator => g !== null)
    : listGenerators();

  // Global daily volume cap (Phase 12n.4). Read once; budget is shared across
  // all generators this run, mirroring the CLI's pre-generate check.
  const cap = await checkDailyCap(now);
  if (cap.exhausted) {
    return {
      generatorsRun: 0,
      candidatesAuthored: 0,
      published: 0,
      statusCounts: {},
      capExhausted: true,
      cap: { used: cap.used, remaining: cap.remaining },
    };
  }

  let remaining = cap.remaining;
  let generatorsRun = 0;
  let candidatesAuthored = 0;
  let published = 0;
  const statusCounts: Record<string, number> = {};

  for (const generator of generators) {
    if (remaining <= 0) break;

    const sourceId = await resolveSourceId(generator.slug);
    if (!sourceId) {
      // No seeded source row — skip (the FK on every candidate needs it).
      continue;
    }

    generatorsRun += 1;
    const produced = await generator.generate({ now: () => now });
    // CLI-level ceiling: truncate to the remaining shared budget.
    const candidates = applyDailyCap(produced, remaining);

    for (const c of candidates) {
      const candidateId = await upsertCandidate(sourceId, c, now);
      const result = await processNativeEnrichment({
        candidateId,
        triggeredBy: "cron",
      });
      candidatesAuthored += 1;
      remaining -= 1;
      statusCounts[result.terminalStatus] =
        (statusCounts[result.terminalStatus] ?? 0) + 1;
      if (result.terminalStatus === "published") published += 1;
    }
  }

  return {
    generatorsRun,
    candidatesAuthored,
    published,
    statusCounts,
    capExhausted: false,
    cap: { used: cap.used, remaining: cap.remaining },
  };
}

export { NATIVE_DAILY_CAP };
