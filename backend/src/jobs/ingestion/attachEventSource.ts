// Phase 12e.6b — cluster-match attach path. Consumed by enrichmentJob's
// two-branch dispatch when the embedding seam reports a cluster hit
// against an existing event in the trailing-72h window.
//
// Behavior:
//   1. Load incoming candidate + its source (priority + name).
//   2. Load the matched event's current role='primary' row + that
//      source's priority.
//   3. If incoming.priority < currentPrimary.priority (lower = higher
//      priority), promote: demote existing primary to 'alternate',
//      insert new row as 'primary'. Otherwise insert as 'alternate'.
//   4. Mark candidate as published with resolved_event_id pointing at
//      the matched event.
//
// All writes happen inside a single Drizzle transaction so a partial
// state — new alternate row landed but candidate status not advanced,
// or promotion's demote landed but new primary insert violates the
// partial unique index — is impossible.
//
// Re-enrichment (12e.6c) is NOT triggered here — see the TODO inside
// loadCandidateForAttach where bodyText is loaded so the seam will be
// 12e.6c-ready without a second DB query at that time.

import { and, eq } from "drizzle-orm";

import { db as defaultDb } from "../../db";
import {
  eventSources,
  ingestionCandidates,
  ingestionSources,
} from "../../db/schema";

export interface AttachEventSourceInput {
  candidateId: string;
  matchedEventId: string;
  similarity: number;
}

export type AttachFailureReason =
  | "attach_db_error"
  | "attach_source_missing";

export type AttachEventSourceResult =
  | { ok: true; promoted: boolean }
  | { ok: false; rejectionReason: AttachFailureReason; error?: unknown };

export interface AttachEventSourceDeps {
  db?: typeof defaultDb;
  now?: () => Date;
}

interface CandidateRowForAttach {
  ingestionSourceId: string | null;
  url: string;
  rawTitle: string | null;
  bodyText: string | null;
  sourcePriority: number | null;
  sourceDisplayName: string | null;
}

async function loadCandidateForAttach(
  db: typeof defaultDb,
  candidateId: string,
): Promise<CandidateRowForAttach | null> {
  const rows = await db
    .select({
      ingestionSourceId: ingestionCandidates.ingestionSourceId,
      url: ingestionCandidates.url,
      rawTitle: ingestionCandidates.rawTitle,
      // TODO(12e.6c): bodyText loaded here for re-enrichment trigger check.
      // When 12e.6c lands, add: if (wordCount(bodyText) > wordCount(primary.bodyText))
      // → trigger re-enrich pipeline against the matched event.
      bodyText: ingestionCandidates.bodyText,
      sourcePriority: ingestionSources.priority,
      sourceDisplayName: ingestionSources.displayName,
    })
    .from(ingestionCandidates)
    .leftJoin(
      ingestionSources,
      eq(ingestionSources.id, ingestionCandidates.ingestionSourceId),
    )
    .where(eq(ingestionCandidates.id, candidateId))
    .limit(1);
  return (rows[0] as CandidateRowForAttach | undefined) ?? null;
}

interface CurrentPrimaryRow {
  id: string;
  ingestionSourceId: string | null;
  priority: number | null;
}

async function loadCurrentPrimary(
  db: typeof defaultDb,
  matchedEventId: string,
): Promise<CurrentPrimaryRow | null> {
  const rows = await db
    .select({
      id: eventSources.id,
      ingestionSourceId: eventSources.ingestionSourceId,
      priority: ingestionSources.priority,
    })
    .from(eventSources)
    .leftJoin(
      ingestionSources,
      eq(ingestionSources.id, eventSources.ingestionSourceId),
    )
    .where(
      and(
        eq(eventSources.eventId, matchedEventId),
        eq(eventSources.role, "primary"),
      ),
    )
    .limit(1);
  return (rows[0] as CurrentPrimaryRow | undefined) ?? null;
}

export async function attachEventSource(
  input: AttachEventSourceInput,
  deps: AttachEventSourceDeps = {},
): Promise<AttachEventSourceResult> {
  const db = deps.db ?? defaultDb;
  const now = deps.now ?? ((): Date => new Date());

  const candidate = await loadCandidateForAttach(db, input.candidateId);
  if (!candidate || !candidate.ingestionSourceId) {
    return { ok: false, rejectionReason: "attach_source_missing" };
  }

  const incomingPriority = candidate.sourcePriority ?? 3;
  const currentPrimary = await loadCurrentPrimary(db, input.matchedEventId);

  // Promotion fires only when:
  //   - a current primary row exists
  //   - its source FK and priority are resolvable (not NULL from a
  //     deleted ingestion_sources row — null FK/priority means we can't
  //     compare, so keep the existing primary)
  //   - the incoming candidate's priority strictly outranks (lower wins)
  // Equal priority keeps the existing primary (first-mover wins on ties).
  const promote =
    currentPrimary !== null &&
    currentPrimary.priority !== null &&
    incomingPriority < currentPrimary.priority;

  try {
    return await db.transaction(async (tx) => {
      if (promote && currentPrimary) {
        // Demote first to free the partial unique index
        // (event_sources_one_primary_per_event ON event_sources (event_id)
        // WHERE role = 'primary'). Inserting the new primary before this
        // demote would violate the constraint.
        await tx
          .update(eventSources)
          .set({ role: "alternate" })
          .where(eq(eventSources.id, currentPrimary.id));

        await tx.insert(eventSources).values({
          eventId: input.matchedEventId,
          ingestionSourceId: candidate.ingestionSourceId,
          url: candidate.url,
          name: candidate.sourceDisplayName,
          role: "primary",
        });
      } else {
        await tx.insert(eventSources).values({
          eventId: input.matchedEventId,
          ingestionSourceId: candidate.ingestionSourceId,
          url: candidate.url,
          name: candidate.sourceDisplayName,
          role: "alternate",
        });
      }

      await tx
        .update(ingestionCandidates)
        .set({
          status: "published",
          resolvedEventId: input.matchedEventId,
          statusReason: null,
          processedAt: now(),
        })
        .where(eq(ingestionCandidates.id, input.candidateId));

      // eslint-disable-next-line no-console
      console.log(
        `[ingestion-attach] candidate=${input.candidateId} event=${input.matchedEventId} similarity=${input.similarity.toFixed(4)} promoted=${promote}`,
      );

      return { ok: true as const, promoted: promote };
    });
  } catch (error) {
    return { ok: false, rejectionReason: "attach_db_error", error };
  }
}
