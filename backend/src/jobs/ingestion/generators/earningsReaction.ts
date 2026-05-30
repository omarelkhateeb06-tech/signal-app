// Phase 12n.3 — SEC EDGAR earnings/filing-reaction native generator.
//
// AUTHORS one native post per qualifying EDGAR filing event in a tight 48h
// window. Unlike the arXiv / HN synthesis generators (one post across many
// signals), this is PER-FILING: an earnings/filing reaction is time-sensitive
// and entity-specific — "here is the ONE number in <Company>'s print that
// moved the thesis," authored fresh off a single filing.
//
//   DISCOVER  published EDGAR events from the last 48h (the `events` table,
//             already enriched). A primary `event_sources` row whose
//             `ingestion_sources.adapter_type='sec_edgar_json'` identifies a
//             filing event. Finance primarily; Semis when sector-tagged.
//   QUALIFY   per event: dedup by external_id `earnings:{slug}:{filing-date}`
//             so a given filer/date is never double-posted. No substance gate
//             beyond the model's own decline path — published events already
//             cleared SIGNAL's relevance bar.
//   AUTHOR    hand the company, headline, and accessible thesis to Haiku,
//             which names the one number that mattered (one call per event).
//             The model DECLINES (skip) when the filing is administrative or
//             carries no material new financial signal. The standard 3-tier
//             enrichment seam then runs on the authored body.
//
// Sector scope: Finance and Semiconductors. EDGAR filings are not an AI
// signal. Per-run cap 2.
//
// Slug `earnings-reaction-native` — seeded by migration 0039. The CLI dry-run
// tolerates a missing row; a real run requires it.

import {
  EARNINGS_REACTION_ASSISTANT_PREFILL,
  EARNINGS_REACTION_MAX_TOKENS,
  buildEarningsReactionPrompt,
  type EarningsReactionInputs,
} from "../../../llm/prompts/ingestion/earningsReactionPrompt";
import { callHaikuForCommentary, type HaikuClientDeps } from "../../../services/haikuCommentaryClient";
import { parseTierTemplate } from "../../../utils/depthVariants";
import { VALID_SECTORS, type Sector } from "../relevanceSeam";
import type { NativeCandidate, NativeGenerator, NativeGeneratorContext } from "./types";
import { z } from "zod";

// ---- Config ----

export const EARNINGS_REACTION_SLUG = "earnings-reaction-native";

// One post per qualifying filing; cap at 2/run to stay within the ~10/day
// native budget and avoid flooding the feed off a single EDGAR poll.
export const MAX_REACTION_POSTS_PER_RUN = 2;

// Tight window: a filing reaction is only editorial while it's fresh. 48h
// covers the print + the immediate next-session read.
export const REACTION_WINDOW_HOURS = 48;

// Cap on filings considered per run. Newest first; beyond a few the older
// ones aren't "today's print" anymore.
export const MAX_EVENTS_CONSIDERED = 3;

// Sectors this generator reacts to. AI is out — EDGAR filings are a
// finance/semis signal. Order is the run priority.
export const REACTION_SECTORS: readonly Sector[] = ["finance", "semiconductors"];

// Dedup look-back for already-authored filing external_ids. One day past the
// content window so a late re-run still sees the prior post.
export const DEDUP_WINDOW_HOURS = REACTION_WINDOW_HOURS + 24;

// ---- Model output contract ----

const EarningsReactionOutputSchema = z
  .object({
    headline: z.string().min(8).max(200),
    body: z.string().min(200).max(2400),
  })
  .strict();

export type EarningsReactionOutput = z.infer<typeof EarningsReactionOutputSchema>;

export type AuthorOutcome =
  | { status: "authored"; output: EarningsReactionOutput }
  | { status: "skipped"; reason: string }
  | { status: "error"; reason: string };

// ---- Discovery shapes ----

// One published EDGAR filing event row, as the discover dep returns it.
// `sourceSlug` is the primary source's ingestion_sources.slug — the stable
// part of the per-filing external_id. `company` is the best-known filer
// identity (primary_source_name), falling back to null when unresolved.
export interface EarningsEventRow {
  sector: string;
  headline: string;
  company: string | null; // events.primary_source_name
  template: string | null; // events.why_it_matters_template (TierTemplate JSON)
  genericCommentary: string | null;
  whyItMatters: string;
  publishedAt: string | null;
  url: string; // events.primary_source_url
  sourceSlug: string; // primary event_source's ingestion_sources.slug
  sourceName: string; // primary event_source's display name (for the SOURCE beat)
}

// ---- Pure helpers (exported for tests) ----

// Distill a row to its one-sentence "why it matters". Prefers the per-tier
// `accessible.thesis`; falls back to generic_commentary, then why_it_matters.
export function accessibleThesisOf(row: EarningsEventRow): string {
  const tmpl = parseTierTemplate(row.template);
  if (tmpl) return tmpl.accessible.thesis;
  if (row.genericCommentary && row.genericCommentary.trim().length > 0) {
    return row.genericCommentary.trim();
  }
  return row.whyItMatters;
}

function isSector(value: string): value is Sector {
  return (VALID_SECTORS as readonly string[]).includes(value);
}

// The filing date that anchors the external_id and the period framing.
// Prefers publishedAt; null when the event carried no published timestamp.
export function filingDateOf(row: EarningsEventRow): string | null {
  return row.publishedAt;
}

// Per-filing dedup key. `slug` is the EDGAR source slug; `date` is the
// filing date (YYYY-MM-DD) so re-running over the same poll is a no-op and
// two filings from the same filer on different days stay distinct.
export function earningsReactionExternalId(slug: string, dateIso: string): string {
  return `earnings:${slug}:${dateIso.slice(0, 10)}`;
}

// Keep only in-scope sectors, newest first. Rows in out-of-scope sectors
// (e.g. ai) are dropped.
export function scopeAndSort(rows: EarningsEventRow[]): EarningsEventRow[] {
  const byDate = (a: EarningsEventRow, b: EarningsEventRow): number => {
    const at = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const bt = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    return bt - at;
  };
  return rows
    .filter((r) => isSector(r.sector) && REACTION_SECTORS.includes(r.sector as Sector))
    .sort(byDate);
}

// ---- Generator deps (injectable for tests) ----

export interface EarningsReactionDeps {
  // Published EDGAR filing events in the window. Tests inject canned rows;
  // production joins events → primary event_sources → ingestion_sources.
  discover?: (now: Date) => Promise<EarningsEventRow[]>;
  // External IDs this generator already authored in the dedup window. Tests
  // inject; production reads candidates.
  existingExternalIds?: (now: Date) => Promise<Set<string>>;
  haiku?: HaikuClientDeps;
  authorPost?: (
    inputs: EarningsReactionInputs,
    haiku?: HaikuClientDeps,
  ) => Promise<AuthorOutcome>;
}

// Discover published EDGAR filing events in the window. Fail-CLOSED: any DB
// error returns []. A filing event is one whose PRIMARY event_source maps to
// an ingestion_sources row with adapter_type='sec_edgar_json'.
async function defaultDiscover(now: Date): Promise<EarningsEventRow[]> {
  try {
    const [{ db }, schema, drizzle] = await Promise.all([
      import("../../../db"),
      import("../../../db/schema"),
      import("drizzle-orm"),
    ]);
    const { events, eventSources, ingestionSources } = schema;
    const { and, eq, gt } = drizzle;
    const since = new Date(now.getTime() - REACTION_WINDOW_HOURS * 3600 * 1000);
    const rows = await db
      .select({
        sector: events.sector,
        headline: events.headline,
        company: events.primarySourceName,
        template: events.whyItMattersTemplate,
        genericCommentary: events.genericCommentary,
        whyItMatters: events.whyItMatters,
        publishedAt: events.publishedAt,
        url: events.primarySourceUrl,
        sourceSlug: ingestionSources.slug,
        sourceName: ingestionSources.displayName,
      })
      .from(events)
      .innerJoin(
        eventSources,
        and(eq(eventSources.eventId, events.id), eq(eventSources.role, "primary")),
      )
      .innerJoin(
        ingestionSources,
        eq(eventSources.ingestionSourceId, ingestionSources.id),
      )
      .where(
        and(
          eq(events.sourceType, "ingested"),
          eq(ingestionSources.adapterType, "sec_edgar_json"),
          gt(events.createdAt, since),
        ),
      );
    return rows.map((r) => ({
      sector: r.sector,
      headline: r.headline,
      company: r.company,
      template: r.template,
      genericCommentary: r.genericCommentary,
      whyItMatters: r.whyItMatters,
      publishedAt:
        r.publishedAt instanceof Date
          ? r.publishedAt.toISOString()
          : (r.publishedAt as string | null),
      url: r.url,
      sourceSlug: r.sourceSlug,
      sourceName: r.sourceName,
    }));
  } catch {
    return [];
  }
}

// External IDs this generator's source already produced in the dedup window.
// Fail-OPEN: any DB error returns an empty set (the per-source unique
// constraint on ingestion_candidates still blocks a duplicate row on insert).
async function defaultExistingExternalIds(now: Date): Promise<Set<string>> {
  try {
    const [{ db }, schema, drizzle] = await Promise.all([
      import("../../../db"),
      import("../../../db/schema"),
      import("drizzle-orm"),
    ]);
    const { ingestionCandidates, ingestionSources } = schema;
    const { and, eq, gt } = drizzle;
    const since = new Date(now.getTime() - DEDUP_WINDOW_HOURS * 3600 * 1000);
    const rows = await db
      .select({ externalId: ingestionCandidates.externalId })
      .from(ingestionCandidates)
      .innerJoin(
        ingestionSources,
        eq(ingestionCandidates.ingestionSourceId, ingestionSources.id),
      )
      .where(
        and(
          eq(ingestionSources.slug, EARNINGS_REACTION_SLUG),
          gt(ingestionCandidates.discoveredAt, since),
        ),
      );
    return new Set(rows.map((r) => r.externalId));
  } catch {
    return new Set();
  }
}

async function defaultAuthorPost(
  inputs: EarningsReactionInputs,
  haiku?: HaikuClientDeps,
): Promise<AuthorOutcome> {
  const prompt = buildEarningsReactionPrompt(inputs);
  const result = await callHaikuForCommentary(prompt, haiku, {
    assistantPrefill: EARNINGS_REACTION_ASSISTANT_PREFILL,
    maxTokens: EARNINGS_REACTION_MAX_TOKENS,
  });
  if (!result.ok) return { status: "error", reason: "llm_call_failed" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.text);
  } catch {
    return { status: "error", reason: "parse_error" };
  }
  if (
    parsed !== null &&
    typeof parsed === "object" &&
    (parsed as { skip?: unknown }).skip === true
  ) {
    const rawReason = (parsed as { reason?: unknown }).reason;
    const reason =
      typeof rawReason === "string" && rawReason.trim().length > 0
        ? rawReason.trim()
        : "unspecified";
    return { status: "skipped", reason };
  }
  const validated = EarningsReactionOutputSchema.safeParse(parsed);
  return validated.success
    ? { status: "authored", output: validated.data }
    : { status: "error", reason: "schema_invalid" };
}

export function createEarningsReactionGenerator(
  deps: EarningsReactionDeps = {},
): NativeGenerator {
  const discover = deps.discover ?? defaultDiscover;
  const existingExternalIds =
    deps.existingExternalIds ?? defaultExistingExternalIds;
  const authorPost = deps.authorPost ?? defaultAuthorPost;

  return {
    slug: EARNINGS_REACTION_SLUG,
    async generate(ctx: NativeGeneratorContext): Promise<NativeCandidate[]> {
      const now = ctx.now();
      const emit = ctx.onDiagnostic;

      const rows = await discover(now);
      const scoped = scopeAndSort(rows).slice(0, MAX_EVENTS_CONSIDERED);
      const already = await existingExternalIds(now);

      const candidates: NativeCandidate[] = [];
      for (const row of scoped) {
        if (candidates.length >= MAX_REACTION_POSTS_PER_RUN) break;
        const sector = row.sector as Sector;
        const dateIso = filingDateOf(row);

        // A filing with no published date can't anchor a stable per-filing
        // external_id; skip it rather than collide on a guessed date.
        if (!dateIso) {
          emit?.({
            stage: "discover",
            identifier: `edgar:${row.sourceSlug}`,
            url: row.url,
            decision: "reject",
            reason: "no_filing_date",
            signals: { sector, company: row.company ?? "(unresolved)" },
          });
          continue;
        }

        const externalId = earningsReactionExternalId(row.sourceSlug, dateIso);
        emit?.({
          stage: "discover",
          identifier: externalId,
          url: row.url,
          decision: "pass",
          reason: null,
          signals: {
            sector,
            company: row.company ?? "(unresolved)",
            filing_date: dateIso.slice(0, 10),
          },
        });

        if (already.has(externalId)) {
          emit?.({
            stage: "qualify",
            identifier: externalId,
            url: row.url,
            decision: "reject",
            reason: "already_posted",
            signals: { sector, filing_date: dateIso.slice(0, 10) },
          });
          continue;
        }
        emit?.({
          stage: "qualify",
          identifier: externalId,
          url: row.url,
          decision: "pass",
          reason: null,
          signals: { sector, filing_date: dateIso.slice(0, 10) },
        });

        const inputs: EarningsReactionInputs = {
          sector,
          company: row.company,
          headline: row.headline,
          accessibleThesis: accessibleThesisOf(row),
          filingDate: dateIso,
          sourceName: row.sourceName,
        };

        const outcome = await authorPost(inputs, deps.haiku);
        emit?.({
          stage: "author",
          identifier: externalId,
          url: row.url,
          decision: outcome.status === "authored" ? "pass" : "reject",
          reason: outcome.status === "authored" ? null : outcome.reason,
          detail:
            outcome.status === "authored"
              ? outcome.output.headline
              : `${outcome.status}: ${outcome.reason}`,
          signals: { sector, company: row.company ?? "(unresolved)" },
        });
        if (outcome.status !== "authored") continue;
        const post = outcome.output;

        candidates.push({
          externalId,
          url: row.url,
          headline: post.headline,
          body: post.body,
          sector,
          summary: `EDGAR filing reaction — ${row.company ?? "filer"}, ${dateIso.slice(0, 10)}.`,
          rawPayload: {
            generator: "earnings-reaction",
            sector,
            company: row.company,
            filing_date: dateIso,
            source_slug: row.sourceSlug,
            source_name: row.sourceName,
            event_headline: row.headline,
            event_url: row.url,
          },
        });
      }

      return candidates.slice(0, MAX_REACTION_POSTS_PER_RUN);
    },
  };
}

// Default instance registered in generators/index.ts.
export const earningsReactionGenerator = createEarningsReactionGenerator();
