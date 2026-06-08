// Selective backfill — regenerate tier outputs for recent events so their
// feed-visible commentary reflects the hook-first thesis prompts shipped in
// PR #102 (tierAccessible.ts / tierBriefed.ts / tierTechnical.ts).
//
// ──────────────────────────────────────────────────────────────────────────
// WHY THIS SCRIPT EXISTS (propagation path, confirmed by audit)
// ──────────────────────────────────────────────────────────────────────────
// Commentary for an INGESTED event lives in three columns on `events`:
//   - why_it_matters_template ← JSON.stringify(tier_outputs)         (3-tier card JSON)
//   - generic_commentary      ← accessible.thesis + " " + accessible.support
//   - why_it_matters          ← briefed.thesis → accessible → technical fallback
// All three are derived from the source candidate's `tier_outputs` jsonb and
// written EXACTLY ONCE, at event-insert time, by writeEvent.ts. There is no
// update path: re-running writeEvent INSERTs a brand-new event (duplicate).
//
// `processTierGeneration` (tierOrchestration.ts) is the regeneration entry
// point — it (re)builds tier_outputs on the CANDIDATE using the current tier
// prompt files. But it is idempotent: it skips any tier already present in
// tier_outputs. So to force a fresh generation we must FIRST clear the
// candidate's tier_outputs, THEN re-run it. And because writeEvent won't
// re-fire, we must propagate the regenerated tier_outputs onto the existing
// `events` row OURSELVES — by calling the same pure compute* helpers
// writeEvent uses and issuing a direct UPDATE.
//
// Two preconditions surfaced in the audit and are handled below:
//   1. runTierGenerationSeam (called inside processTierGeneration) REJECTS any
//      candidate whose status is not 'facts_extracted' | 'tier_generated'. A
//      published candidate is status='published', so we temporarily set it to
//      'facts_extracted' while regenerating, then restore 'published'.
//   2. A single event can have multiple candidates pointing at it via
//      resolved_event_id (cluster-attached alternates). We regenerate from the
//      PRIMARY-source candidate (event_sources.role='primary'), falling back to
//      the earliest-processed candidate when no primary-source match exists.
//
// Scope is restricted to source_type='ingested'. Native posts (hnRepo /
// crossSectorChain) are authored by different prompts that produce
// {headline, body}, not {thesis, support} tiers — the hook-first change does
// not apply to them and they carry no tier_outputs to regenerate.
//
// ──────────────────────────────────────────────────────────────────────────
// IDEMPOTENCY
// ──────────────────────────────────────────────────────────────────────────
// A candidate's tier_generated_at is stamped with now() every time
// processTierGeneration completes. We only act on candidates whose
// tier_generated_at is NULL or < the prompt-change cutoff. After we regenerate
// a row, its tier_generated_at becomes >= cutoff, so a re-run skips it. This
// gives correct cross-invocation idempotency without a schema marker. New
// events ingested after the prompt change already have tier_generated_at >=
// cutoff and are correctly skipped (they never had the old prompts).
//
// ──────────────────────────────────────────────────────────────────────────
// SAFETY
// ──────────────────────────────────────────────────────────────────────────
// - DRY_RUN is the default. Nothing is cleared, no Haiku call is made, no row
//   is touched until DRY_RUN=false (or --execute) is passed.
// - Per event we snapshot the old tier_outputs before clearing and RESTORE it
//   if regeneration fails, so a failed row keeps its original (old-prompt)
//   commentary rather than going blank. The existing events row is only
//   overwritten on a fully successful 3-tier regeneration.
// - Single-event failures are logged and skipped; the run never aborts.
//
// ──────────────────────────────────────────────────────────────────────────
// CLI
// ──────────────────────────────────────────────────────────────────────────
//   npm run backfill-tier-outputs                  # dry run (default)
//   npm run backfill-tier-outputs -- --execute     # real run
//   DRY_RUN=false npm run backfill-tier-outputs    # real run (env form)
//   npm run backfill-tier-outputs -- --days=7      # window (default 7)
//   npm run backfill-tier-outputs -- --cutoff=2026-06-01T00:00:00Z
//
// Requires ANTHROPIC_API_KEY for the real run (Haiku tier generation).

import "../lib/loadEnv";
import { eq, sql } from "drizzle-orm";

import { db } from "../db";
import { events, ingestionCandidates } from "../db/schema";
import { processTierGeneration } from "../jobs/ingestion/tierOrchestration";
import {
  computeGenericCommentary,
  computeWhyItMatters,
  computeWhyItMattersTemplate,
  type CandidateRowForWrite,
} from "../jobs/ingestion/writeEvent";

// Prompt-change cutoff — PR #102 (hook-first thesis rules) merged 2026-06-01.
// Candidates whose tier_generated_at is < this were generated with the old
// prompts and are eligible for backfill; >= this means already regenerated.
const DEFAULT_CUTOFF_ISO = "2026-06-01T00:00:00Z";

const DEFAULT_WINDOW_DAYS = 7;
const BATCH_SIZE = 5;
const INTER_BATCH_DELAY_MS = 1000;

interface Args {
  dryRun: boolean;
  windowDays: number;
  cutoffIso: string;
}

function parseArgs(argv: readonly string[]): Args {
  // DRY_RUN defaults to TRUE. Only an explicit --execute flag or
  // DRY_RUN=false / DRY_RUN=0 in the environment disables it.
  let dryRun = true;
  if (argv.includes("--execute")) dryRun = false;
  const envDryRun = process.env.DRY_RUN;
  if (envDryRun === "false" || envDryRun === "0") dryRun = false;

  let windowDays = DEFAULT_WINDOW_DAYS;
  let cutoffIso = DEFAULT_CUTOFF_ISO;
  for (const arg of argv) {
    const daysMatch = /^--days=(\d+)$/.exec(arg);
    if (daysMatch) windowDays = Number(daysMatch[1]);
    const cutoffMatch = /^--cutoff=(.+)$/.exec(arg);
    if (cutoffMatch) cutoffIso = cutoffMatch[1];
  }
  return { dryRun, windowDays, cutoffIso };
}

interface ScopeRow {
  eventId: string;
  headline: string;
  createdAt: string;
  candidateId: string;
}

/**
 * In-scope = ingested events within the window whose PRIMARY-source candidate
 * has not yet been regenerated post-cutoff. The LATERAL join picks one
 * candidate per event, preferring the one whose source matches the event's
 * primary source, then the earliest-processed.
 */
async function loadScope(args: Args): Promise<ScopeRow[]> {
  const result = await db.execute<{
    event_id: string;
    headline: string;
    created_at: string;
    candidate_id: string;
  }>(sql`
    SELECT
      e.id          AS event_id,
      e.headline    AS headline,
      e.created_at  AS created_at,
      c.id          AS candidate_id
    FROM events e
    JOIN LATERAL (
      SELECT ic.id, ic.tier_generated_at
      FROM ingestion_candidates ic
      WHERE ic.resolved_event_id = e.id
      ORDER BY
        (ic.ingestion_source_id = (
          SELECT es.ingestion_source_id
          FROM event_sources es
          WHERE es.event_id = e.id AND es.role = 'primary'
          LIMIT 1
        )) DESC NULLS LAST,
        ic.processed_at ASC NULLS LAST
      LIMIT 1
    ) c ON TRUE
    WHERE e.created_at > now() - (${String(args.windowDays)} || ' days')::interval
      AND e.source_type = 'ingested'
      AND (
        (SELECT ic2.tier_generated_at
           FROM ingestion_candidates ic2
          WHERE ic2.id = c.id) IS NULL
        OR (SELECT ic2.tier_generated_at
              FROM ingestion_candidates ic2
             WHERE ic2.id = c.id) < ${args.cutoffIso}::timestamptz
      )
    ORDER BY e.created_at DESC
  `);
  const rows = (result as unknown as { rows: Array<{
    event_id: string;
    headline: string;
    created_at: string;
    candidate_id: string;
  }> }).rows;
  return rows.map((r) => ({
    eventId: r.event_id,
    headline: r.headline,
    createdAt: r.created_at,
    candidateId: r.candidate_id,
  }));
}

type CandidateStatus = typeof ingestionCandidates.$inferSelect["status"];

interface CandidateSnapshot {
  status: CandidateStatus;
  tierOutputs: Record<string, unknown> | null;
  tierOutputsRaw: Record<string, unknown> | null;
  rawTitle: string | null;
  sector: string | null;
  facts: Record<string, unknown> | null;
}

async function loadCandidateSnapshot(
  candidateId: string,
): Promise<CandidateSnapshot | null> {
  const rows = await db
    .select({
      status: ingestionCandidates.status,
      tierOutputs: ingestionCandidates.tierOutputs,
      tierOutputsRaw: ingestionCandidates.tierOutputsRaw,
      rawTitle: ingestionCandidates.rawTitle,
      sector: ingestionCandidates.sector,
      facts: ingestionCandidates.facts,
    })
    .from(ingestionCandidates)
    .where(eq(ingestionCandidates.id, candidateId))
    .limit(1);
  return (rows[0] as CandidateSnapshot | undefined) ?? null;
}

type EventOutcome = "generated" | "skipped" | "failed";

async function processEvent(row: ScopeRow): Promise<EventOutcome> {
  const tag = `event=${row.eventId} candidate=${row.candidateId} "${row.headline.slice(0, 60)}"`;

  const snapshot = await loadCandidateSnapshot(row.candidateId);
  if (!snapshot) {
    // eslint-disable-next-line no-console
    console.warn(`[backfill-tier] SKIPPED (no candidate) ${tag}`);
    return "skipped";
  }

  // Step 1 — clear tier_outputs + reset status so the seam will regenerate.
  // eslint-disable-next-line no-console
  console.log(`[backfill-tier] cleared ${tag}`);
  await db
    .update(ingestionCandidates)
    .set({
      tierOutputs: null,
      tierOutputsRaw: null,
      status: "facts_extracted",
      tierGeneratedAt: null,
      statusReason: null,
    })
    .where(eq(ingestionCandidates.id, row.candidateId));

  // Step 2 — regenerate all three tiers with the current (hook-first) prompts.
  let summary;
  try {
    summary = await processTierGeneration(row.candidateId);
  } catch (err) {
    await restoreCandidate(row.candidateId, snapshot);
    // eslint-disable-next-line no-console
    console.error(
      `[backfill-tier] FAILED (threw) ${tag}:`,
      err instanceof Error ? err.message : err,
    );
    return "failed";
  }

  if (!summary.completed) {
    // Regeneration did not produce all three tiers — restore the original
    // tier_outputs so the event keeps its old-prompt commentary intact.
    await restoreCandidate(row.candidateId, snapshot);
    const reason = summary.failedTier
      ? `${summary.failedTier.tier}:${summary.failedTier.reason}`
      : "incomplete";
    // eslint-disable-next-line no-console
    console.error(`[backfill-tier] FAILED (${reason}) ${tag}`);
    return "failed";
  }

  // Step 3 — propagate the fresh tier_outputs onto the existing events row.
  const fresh = await loadCandidateSnapshot(row.candidateId);
  if (!fresh) {
    // eslint-disable-next-line no-console
    console.error(`[backfill-tier] FAILED (candidate vanished) ${tag}`);
    return "failed";
  }

  // Build the minimal CandidateRowForWrite the pure compute* helpers need.
  // Only tierOutputs / rawTitle / facts are read by those helpers; the
  // remaining fields are filled with inert placeholders to satisfy the type.
  const candForWrite: CandidateRowForWrite = {
    id: row.candidateId,
    ingestionSourceId: "",
    url: "",
    rawTitle: fresh.rawTitle,
    rawSummary: null,
    rawPublishedAt: null,
    bodyText: null,
    sector: fresh.sector,
    facts: fresh.facts,
    tierOutputs: fresh.tierOutputs,
    embedding: null,
    imageUrl: null,
    sourceDisplayName: "",
    sourcePairedWriterId: null,
    sourceAdapterType: "rss",
    sourceConfig: null,
  };

  let whyItMatters: string;
  let whyItMattersTemplate: string;
  let genericCommentary: string;
  try {
    whyItMatters = computeWhyItMatters(candForWrite);
    whyItMattersTemplate = computeWhyItMattersTemplate(candForWrite);
    genericCommentary = computeGenericCommentary(candForWrite);
  } catch (err) {
    // assertTierTemplate threw — regenerated blob failed validation. Leave the
    // events row untouched but restore 'published' status on the candidate
    // (tier_generated_at is already now() from the successful seam run).
    await db
      .update(ingestionCandidates)
      .set({ status: "published" })
      .where(eq(ingestionCandidates.id, row.candidateId));
    // eslint-disable-next-line no-console
    console.error(
      `[backfill-tier] FAILED (template assert) ${tag}:`,
      err instanceof Error ? err.message : err,
    );
    return "failed";
  }

  await db.transaction(async (tx) => {
    await tx
      .update(events)
      .set({
        whyItMatters,
        whyItMattersTemplate,
        genericCommentary,
        updatedAt: new Date(),
      })
      .where(eq(events.id, row.eventId));
    // Restore the candidate's terminal status (the seam flipped it to
    // 'tier_generated'); its resolved_event_id is unchanged.
    await tx
      .update(ingestionCandidates)
      .set({ status: "published" })
      .where(eq(ingestionCandidates.id, row.candidateId));
  });

  // eslint-disable-next-line no-console
  console.log(`[backfill-tier] generated ${tag}`);
  return "generated";
}

async function restoreCandidate(
  candidateId: string,
  snapshot: CandidateSnapshot,
): Promise<void> {
  await db
    .update(ingestionCandidates)
    .set({
      tierOutputs: snapshot.tierOutputs,
      tierOutputsRaw: snapshot.tierOutputsRaw,
      // Original terminal status (published); the row already resolved to its
      // event, so we put it back exactly as we found it.
      status: snapshot.status,
    })
    .where(eq(ingestionCandidates.id, candidateId));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  // eslint-disable-next-line no-console
  console.log(
    `[backfill-tier-outputs] dryRun=${args.dryRun} windowDays=${args.windowDays} cutoff=${args.cutoffIso}`,
  );

  const scope = await loadScope(args);

  // ── Scope report (always printed) ──
  // eslint-disable-next-line no-console
  console.log(`[scope] in-scope events: ${scope.length}`);
  if (scope.length > 0) {
    const newest = scope[0].createdAt;
    const oldest = scope[scope.length - 1].createdAt;
    // eslint-disable-next-line no-console
    console.log(`[scope] created_at range: ${oldest} … ${newest}`);
    // eslint-disable-next-line no-console
    console.log("[scope] sample (first 5):");
    for (const r of scope.slice(0, 5)) {
      // eslint-disable-next-line no-console
      console.log(`  - ${r.eventId}  ${r.headline.slice(0, 80)}`);
    }
  }

  if (args.dryRun) {
    // eslint-disable-next-line no-console
    console.log(
      "[backfill-tier-outputs] DRY RUN — no DB writes, no Haiku calls. " +
        "Re-run with --execute (or DRY_RUN=false) to apply.",
    );
    process.exit(0);
    return;
  }

  // ── Real run ──
  const stats = { generated: 0, skipped: 0, failed: 0 };
  for (let i = 0; i < scope.length; i += BATCH_SIZE) {
    const batch = scope.slice(i, i + BATCH_SIZE);
    const outcomes = await Promise.all(batch.map((r) => processEvent(r)));
    for (const o of outcomes) stats[o] += 1;
    // eslint-disable-next-line no-console
    console.log(
      `[backfill-tier-outputs] progress ${Math.min(i + BATCH_SIZE, scope.length)}/${scope.length} ` +
        `(generated=${stats.generated} skipped=${stats.skipped} failed=${stats.failed})`,
    );
    if (i + BATCH_SIZE < scope.length) await sleep(INTER_BATCH_DELAY_MS);
  }

  // eslint-disable-next-line no-console
  console.log(
    `[backfill-tier-outputs] DONE generated=${stats.generated} skipped=${stats.skipped} failed=${stats.failed}`,
  );
  process.exit(0);
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[backfill-tier-outputs] FATAL", err);
    process.exit(1);
  });
}
