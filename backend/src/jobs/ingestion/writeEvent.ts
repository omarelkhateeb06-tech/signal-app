// Phase 12e.5c sub-step 3 — events row writer.
//
// Consumes one fully-extracted `ingestion_candidates` row (status =
// 'tier_generated', `tier_outputs` complete with all three tiers) and
// writes:
//   1. One `events` row.
//   2. One `event_sources` row with `role='primary'`.
//   3. Updates the candidate's status to 'published', stamps
//      `processed_at`, sets `resolved_event_id` to the new event's id.
//
// All three writes happen in a single Drizzle transaction so a partial-
// success state is impossible: either all three land or none do.
//
// Field-mapping rules (locked in 12e.5c sub-step 3 brief):
//   - `headline`            ← candidate.raw_title (truncated to 255 to
//                             satisfy varchar constraint; real RSS
//                             headlines don't approach this)
//   - `context`             ← raw_summary if non-empty, else first 500
//                             chars of body_text truncated at the last
//                             whitespace boundary
//   - `why_it_matters`      ← fallback chain: briefed.thesis →
//                             accessible.thesis → technical.thesis →
//                             synthesized floor (`raw_title: first fact`)
//   - `why_it_matters_template` ← JSON.stringify(tier_outputs) after
//                             assertTierTemplate validation. NULL only
//                             if assertion fails (defensive — should
//                             never happen if upstream tier orchestration
//                             validated each tier's output via
//                             TierOutputSchema before persisting).
//   - `sector`              ← candidate.sector (NOT NULL on events;
//                             populated by relevance gate upstream)
//   - `primary_source_url`  ← candidate.url
//   - `primary_source_name` ← linked source.display_name (always
//                             non-null per ingestion_sources schema)
//   - `author_id`           ← linked source.paired_writer_id (nullable)
//   - `facts`               ← candidate.facts verbatim (NOT NULL,
//                             default '{}'::jsonb on events; we always
//                             write the validated facts blob)
//   - `published_at`        ← candidate.raw_published_at, passed
//                             through. Nullable on events; if the
//                             article didn't carry a publication time,
//                             leave null. Do NOT synthesize.
//
// Status semantics:
//   - candidate.status: 'tier_generated' → 'published'
//   - candidate.processed_at: now() (set inside the same transaction)
//   - candidate.resolved_event_id: new events.id

import { eq } from "drizzle-orm";

import { db as defaultDb } from "../../db";
import {
  events,
  eventSources,
  ingestionCandidates,
  ingestionSources,
} from "../../db/schema";
import { assertTierTemplate } from "../../utils/depthVariants";

// Hard cap on events.headline length — the column is varchar(255) per
// schema. Real RSS headlines almost never exceed ~150 chars; defensive
// truncate handles edge cases without erroring on insert.
const HEADLINE_MAX_CHARS = 255;

// Soft cap on events.context length when synthesized from body_text.
// 500 is a hand-picked balance between "enough for a reader to recognize
// the story" and "small enough to avoid copy-pasting full articles."
const CONTEXT_MAX_CHARS = 500;

// 12e.x — issue #64: retry transient writeEvent failures with
// exponential backoff. Caps at 3 attempts (so two retries after the
// initial try) with a base delay of 500ms; max sleep before the third
// attempt is 1000ms, total worst-case extra latency 1500ms. Tuning
// kept tight on purpose — this is a worker-internal retry, not a
// user-visible call path, so we don't want to hold the candidate's
// status='tier_generated'/resolved_event_id=null partial state for
// long.
const WRITE_EVENT_MAX_ATTEMPTS = 3;
const WRITE_EVENT_BASE_DELAY_MS = 500;

// PG SQLSTATE classes that indicate a retryable transient failure.
// 40xxx — transaction-rollback (serialization_failure, deadlock_detected).
// 08xxx — connection exceptions.
// 53xxx — insufficient resources (out_of_memory, too_many_connections).
// 57P01-03 — admin shutdown / crash shutdown / cannot_connect_now.
const TRANSIENT_PG_CODES: ReadonlySet<string> = new Set([
  "40001",
  "40P01",
  "08000",
  "08003",
  "08006",
  "08001",
  "08004",
  "08007",
  "08P01",
  "53300",
  "53400",
  "57P01",
  "57P02",
  "57P03",
]);

const TRANSIENT_NODE_CODES: ReadonlySet<string> = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "ENOTFOUND",
]);

export function isTransientWriteError(err: unknown): boolean {
  if (err === null || typeof err !== "object") return false;
  // Zod errors and Error subclasses we throw from this module are
  // never transient.
  const name = (err as { name?: string }).name;
  if (name === "ZodError") return false;

  const code = (err as { code?: string }).code;
  if (typeof code === "string" && code.length > 0) {
    if (TRANSIENT_PG_CODES.has(code)) return true;
    if (TRANSIENT_NODE_CODES.has(code)) return true;
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface WriteEventDeps {
  db?: typeof defaultDb;
  now?: () => Date;
  // Test seam: stub the per-attempt sleep so the retry loop doesn't
  // actually wait. Production never sets this.
  sleepMs?: (ms: number) => Promise<void>;
  // Test seam: override the attempt cap. Production never sets this.
  maxAttempts?: number;
}

export interface WriteEventResult {
  eventId: string;
}

// Exported so unit tests of the pure helper functions can construct
// minimal candidate rows without re-deriving the join shape.
export interface CandidateRowForWrite {
  id: string;
  ingestionSourceId: string;
  url: string;
  rawTitle: string | null;
  rawSummary: string | null;
  rawPublishedAt: Date | null;
  bodyText: string | null;
  sector: string | null;
  facts: Record<string, unknown> | null;
  tierOutputs: Record<string, unknown> | null;
  embedding: number[] | null;
  sourceDisplayName: string;
  sourcePairedWriterId: string | null;
}

async function loadCandidateForWrite(
  db: typeof defaultDb,
  candidateId: string,
): Promise<CandidateRowForWrite | null> {
  const rows = await db
    .select({
      id: ingestionCandidates.id,
      ingestionSourceId: ingestionCandidates.ingestionSourceId,
      url: ingestionCandidates.url,
      rawTitle: ingestionCandidates.rawTitle,
      rawSummary: ingestionCandidates.rawSummary,
      rawPublishedAt: ingestionCandidates.rawPublishedAt,
      bodyText: ingestionCandidates.bodyText,
      sector: ingestionCandidates.sector,
      facts: ingestionCandidates.facts,
      tierOutputs: ingestionCandidates.tierOutputs,
      embedding: ingestionCandidates.embedding,
      sourceDisplayName: ingestionSources.displayName,
      sourcePairedWriterId: ingestionSources.pairedWriterId,
    })
    .from(ingestionCandidates)
    .innerJoin(
      ingestionSources,
      eq(ingestionSources.id, ingestionCandidates.ingestionSourceId),
    )
    .where(eq(ingestionCandidates.id, candidateId))
    .limit(1);
  return (rows[0] as CandidateRowForWrite | undefined) ?? null;
}

// Locked fallback chain for events.why_it_matters (NOT NULL):
// briefed.thesis → accessible.thesis → technical.thesis → synthesized
// floor (`headline: first-fact-text`). The floor only fires when
// tier_outputs is missing all thesis values AND facts has at least one
// entry; otherwise we floor again to just `headline` (or "Untitled" if
// that's also missing — last-ditch defensive value to satisfy NOT NULL).
// Exported for unit-testing the fallback chain in isolation.
export function computeWhyItMatters(candidate: CandidateRowForWrite): string {
  const tiers = candidate.tierOutputs as
    | { accessible?: { thesis?: string }; briefed?: { thesis?: string }; technical?: { thesis?: string } }
    | null;
  const briefed = tiers?.briefed?.thesis;
  if (typeof briefed === "string" && briefed.length > 0) return briefed;
  const accessible = tiers?.accessible?.thesis;
  if (typeof accessible === "string" && accessible.length > 0) return accessible;
  const technical = tiers?.technical?.thesis;
  if (typeof technical === "string" && technical.length > 0) return technical;

  // Floor: synthesize from headline + first fact text.
  const headline = (candidate.rawTitle ?? "Untitled").trim();
  const factsBlob = candidate.facts as
    | { facts?: Array<{ text?: string }> }
    | null;
  const firstFactText = factsBlob?.facts?.[0]?.text?.trim();
  if (firstFactText && firstFactText.length > 0) {
    return `${headline}: ${firstFactText}`;
  }
  return headline;
}

// events.context (NOT NULL): raw_summary if non-empty, else first
// CONTEXT_MAX_CHARS of body_text truncated at the last whitespace
// boundary if possible. If body_text is also empty, fall back to
// headline (defensive — schema requires non-null). Exported for
// unit-testing the truncation logic in isolation.
export function computeContext(candidate: CandidateRowForWrite): string {
  const summary = candidate.rawSummary?.trim();
  if (summary && summary.length > 0) return summary;
  const body = candidate.bodyText?.trim();
  if (body && body.length > 0) {
    if (body.length <= CONTEXT_MAX_CHARS) return body;
    const head = body.slice(0, CONTEXT_MAX_CHARS);
    const lastSpace = head.lastIndexOf(" ");
    // Only honor the word boundary if it falls in the latter half of
    // the head — otherwise we'd chop off too much (rare but possible
    // with very long single tokens).
    if (lastSpace > CONTEXT_MAX_CHARS / 2) {
      return head.slice(0, lastSpace);
    }
    return head;
  }
  return (candidate.rawTitle ?? "Untitled").trim();
}

// Validate tier_outputs against TierTemplateSchema and stringify for
// persistence. STRICT-AT-WRITE: throws ZodError on null tier_outputs,
// missing required keys, or any per-tier value failing TierOutputSchema.
// Exported for unit-testing the validate-then-stringify pipeline in
// isolation.
//
// The thrown error propagates out of writeEvent (computeWhyItMattersTemplate
// is called before the db.transaction block, so no rollback is needed —
// the transaction simply never starts) and into processEnrichmentJob's
// try/catch around its writeEvent call, which surfaces it as
// terminalStatus='failed' with 'write_event_error: <ZodError detail>'
// in the result envelope. Sub-step 7 wires the BullMQ failed-handler
// to capture the ZodError to Sentry for operator attention.
//
// Strict-at-write is the locked design (sub-step 3 correction): lenient-
// at-write would silently land null templates for genuinely corrupted
// tier_outputs, hiding data-quality failures from 12e.8 metrics until
// the 12e.7 frontend integration surfaced them. The retry-stuck
// disposition (per locked decision 4) is the right behavior for
// genuinely corrupted state — forces operator attention rather than
// silent data degradation.
//
// NOTE: events.why_it_matters_template uses the 12e.5b per-tier
// {thesis, support} shape, asserted via assertTierTemplate. Existing
// readers (v2/storiesController.ts, personalizationService.ts) parse
// via parseWhyItMattersTemplate, which validates the legacy 12a
// per-tier-string shape and returns null for this shape — so readers
// currently fall back to events.why_it_matters. Reader-side migration
// to parseTierTemplate is tracked separately (12e.7 frontend
// event-rendering or earlier cleanup).
export function computeWhyItMattersTemplate(
  candidate: CandidateRowForWrite,
): string {
  const validated = assertTierTemplate(candidate.tierOutputs);
  return JSON.stringify(validated);
}

async function writeEventOnce(
  candidateId: string,
  deps: WriteEventDeps,
): Promise<WriteEventResult> {
  const db = deps.db ?? defaultDb;
  const now = deps.now ?? ((): Date => new Date());

  const candidate = await loadCandidateForWrite(db, candidateId);
  if (!candidate) {
    throw new Error(
      `writeEvent: candidate ${candidateId} not found (or source join failed)`,
    );
  }
  if (!candidate.sector) {
    throw new Error(
      `writeEvent: candidate ${candidateId} has null sector (relevance gate did not classify)`,
    );
  }

  const headline = (candidate.rawTitle ?? "Untitled")
    .trim()
    .slice(0, HEADLINE_MAX_CHARS);
  const context = computeContext(candidate);
  const whyItMatters = computeWhyItMatters(candidate);
  const whyItMattersTemplate = computeWhyItMattersTemplate(candidate);

  // Validated facts blob (jsonb NOT NULL on events with default '{}').
  // We pass through whatever upstream wrote to candidate.facts — the
  // 12e.5a fact extraction path validates via ExtractedFactsSchema
  // before persisting, so the shape is trustworthy by this point.
  const factsBlob: Record<string, unknown> = candidate.facts ?? {};

  return db.transaction(async (tx) => {
    const insertedEvents = await tx
      .insert(events)
      .values({
        sector: candidate.sector as string,
        headline,
        context,
        whyItMatters,
        whyItMattersTemplate,
        primarySourceUrl: candidate.url,
        primarySourceName: candidate.sourceDisplayName,
        authorId: candidate.sourcePairedWriterId,
        facts: factsBlob,
        publishedAt: candidate.rawPublishedAt,
        embedding: candidate.embedding,
      })
      .returning({ id: events.id });

    const inserted = insertedEvents[0];
    if (!inserted) {
      throw new Error(
        `writeEvent: events insert returned no rows for candidate ${candidateId}`,
      );
    }
    const eventId = inserted.id;

    await tx.insert(eventSources).values({
      eventId,
      ingestionSourceId: candidate.ingestionSourceId,
      url: candidate.url,
      name: candidate.sourceDisplayName,
      role: "primary",
    });

    await tx
      .update(ingestionCandidates)
      .set({
        status: "published",
        resolvedEventId: eventId,
        statusReason: null,
        processedAt: now(),
      })
      .where(eq(ingestionCandidates.id, candidateId));

    // eslint-disable-next-line no-console
    console.log(
      `[ingestion-write-event] candidate=${candidateId} event=${eventId} sector=${candidate.sector} headline_len=${headline.length}`,
    );

    return { eventId };
  });
}

export async function writeEvent(
  candidateId: string,
  deps: WriteEventDeps = {},
): Promise<WriteEventResult> {
  const maxAttempts = deps.maxAttempts ?? WRITE_EVENT_MAX_ATTEMPTS;
  const sleepMs = deps.sleepMs ?? sleep;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await writeEventOnce(candidateId, deps);
    } catch (err) {
      lastErr = err;
      if (!isTransientWriteError(err) || attempt === maxAttempts) {
        throw err;
      }
      // Exponential backoff: 500ms, 1000ms, ...
      const delay = WRITE_EVENT_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      // eslint-disable-next-line no-console
      console.warn(
        `[ingestion-write-event] candidate=${candidateId} transient error on attempt ${attempt}/${maxAttempts}; retrying in ${delay}ms:`,
        err instanceof Error ? err.message : err,
      );
      await sleepMs(delay);
    }
  }
  throw lastErr;
}
