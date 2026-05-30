// Phase 12n.3 — semiconductor supply-chain synthesis native generator.
//
// AUTHORS one native post per run synthesizing the non-obvious CONNECTION
// across the week's CORROBORATED semiconductor supply-chain events. Unlike
// the earnings-reaction generator (one post per filing), this is a SYNTHESIS:
// one post naming the real bottleneck the obvious headlines hide.
//
//   DISCOVER  published semis events from the last 7 days that are
//             CORROBORATED — ≥2 linked `event_sources` rows (the count IS the
//             corroboration; there is no scalar column). Grounding the
//             synthesis in multiply-reported facts, not one outlet's take.
//   QUALIFY   ≥2 corroborated events in the window. Dedup by external_id
//             `supply-chain:semis:{ISO-week}` so a week is never double-posted.
//   AUTHOR    hand up to 5 events' headlines + theses to Haiku, which names
//             the second-order chokepoint across them (one call). The model
//             DECLINES (skip) when all events make the same obvious point.
//             The standard 3-tier enrichment seam then runs on the body.
//
// Sector scope: Semiconductors only — supply-chain bottleneck synthesis is a
// semis signal. Per-run cap 2 (realistically 1; one sector).
//
// Slug `supply-chain-synthesis-native` — seeded by migration 0039. The CLI
// dry-run tolerates a missing row; a real run requires it.

import {
  SUPPLY_CHAIN_SYNTHESIS_ASSISTANT_PREFILL,
  SUPPLY_CHAIN_SYNTHESIS_MAX_TOKENS,
  buildSupplyChainSynthesisPrompt,
  type SupplyChainEventInput,
  type SupplyChainSynthesisInputs,
} from "../../../llm/prompts/ingestion/supplyChainSynthesisPrompt";
import { callHaikuForCommentary, type HaikuClientDeps } from "../../../services/haikuCommentaryClient";
import { parseTierTemplate } from "../../../utils/depthVariants";
import type { Sector } from "../relevanceSeam";
import { isoWeekOf } from "./isoWeek";
import type { NativeCandidate, NativeGenerator, NativeGeneratorContext } from "./types";
import { z } from "zod";

// ---- Config ----

export const SUPPLY_CHAIN_SYNTHESIS_SLUG = "supply-chain-synthesis-native";

// The single sector this generator covers. Native posts are sector-authoritative.
export const SUPPLY_CHAIN_SECTOR: Sector = "semiconductors";

// One post per run; cap 2 as a defensive ceiling though one sector means 1.
export const MAX_SUPPLY_CHAIN_POSTS_PER_RUN = 2;

// Weekly cadence: the synthesis covers the prior 7 days of published events.
export const SYNTHESIS_WINDOW_DAYS = 7;

// A "synthesis" needs at least two events to draw a connection across.
export const MIN_EVENTS = 2;

// Corroboration floor: an event qualifies only with ≥2 linked sources. The
// event_sources row count IS the corroboration count — there is no column.
export const MIN_CORROBORATION = 2;

// Cap on events fed to the prompt. Beyond ~5 the model can't hold a tight
// thesis; the newest are the most representative of "this week".
export const MAX_EVENTS_IN_CONTEXT = 5;

// Dedup look-back for already-authored weekly external_ids. One day past the
// content window so a late re-run in the same ISO week still sees the prior
// post.
export const DEDUP_WINDOW_DAYS = SYNTHESIS_WINDOW_DAYS + 1;

// ---- Model output contract ----

const SupplyChainSynthesisOutputSchema = z
  .object({
    headline: z.string().min(8).max(200),
    body: z.string().min(200).max(2400),
  })
  .strict();

export type SupplyChainSynthesisOutput = z.infer<
  typeof SupplyChainSynthesisOutputSchema
>;

export type AuthorOutcome =
  | { status: "authored"; output: SupplyChainSynthesisOutput }
  | { status: "skipped"; reason: string }
  | { status: "error"; reason: string };

// ---- Discovery shapes ----

// One corroborated semis event row, as the discover dep returns it.
// `corroborationCount` is the aggregated count of linked event_sources rows.
export interface SupplyChainEventRow {
  headline: string;
  template: string | null; // events.why_it_matters_template (TierTemplate JSON)
  genericCommentary: string | null;
  whyItMatters: string;
  corroborationCount: number;
  publishedAt: string | null;
  url: string; // events.primary_source_url
}

// ---- Pure helpers (exported for tests) ----

// Distill a row to its one-sentence "why it matters". Prefers the per-tier
// `accessible.thesis`; falls back to generic_commentary, then why_it_matters.
export function accessibleThesisOf(row: SupplyChainEventRow): string {
  const tmpl = parseTierTemplate(row.template);
  if (tmpl) return tmpl.accessible.thesis;
  if (row.genericCommentary && row.genericCommentary.trim().length > 0) {
    return row.genericCommentary.trim();
  }
  return row.whyItMatters;
}

// Keep only corroborated rows (≥ MIN_CORROBORATION sources), newest first.
export function qualifyAndSort(rows: SupplyChainEventRow[]): SupplyChainEventRow[] {
  const byDate = (a: SupplyChainEventRow, b: SupplyChainEventRow): number => {
    const at = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const bt = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    return bt - at;
  };
  return rows
    .filter((r) => r.corroborationCount >= MIN_CORROBORATION)
    .sort(byDate);
}

export function supplyChainSynthesisExternalId(isoWeek: string): string {
  return `supply-chain:semis:${isoWeek}`;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function dayLabel(d: Date): string {
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

// Human "May 23–May 30, 2026" for the SOURCE beat. `since` is the window
// start, `now` the run time.
export function dateRangeLabelOf(since: Date, now: Date): string {
  return `${dayLabel(since)}–${dayLabel(now)}, ${now.getUTCFullYear()}`;
}

// ---- Generator deps (injectable for tests) ----

export interface SupplyChainSynthesisDeps {
  // Corroborated semis events in the window. Tests inject canned rows;
  // production aggregates event_sources counts.
  discover?: (now: Date) => Promise<SupplyChainEventRow[]>;
  // External IDs this generator already authored in the dedup window. Tests
  // inject; production reads candidates.
  existingExternalIds?: (now: Date) => Promise<Set<string>>;
  haiku?: HaikuClientDeps;
  authorPost?: (
    inputs: SupplyChainSynthesisInputs,
    haiku?: HaikuClientDeps,
  ) => Promise<AuthorOutcome>;
}

// Discover corroborated published semis events in the window. Fail-CLOSED:
// any DB error returns []. Corroboration = count of linked event_sources rows;
// the HAVING clause enforces the ≥2 floor at the database.
async function defaultDiscover(now: Date): Promise<SupplyChainEventRow[]> {
  try {
    const [{ db }, schema, drizzle] = await Promise.all([
      import("../../../db"),
      import("../../../db/schema"),
      import("drizzle-orm"),
    ]);
    const { events, eventSources } = schema;
    const { and, eq, gt, sql } = drizzle;
    const since = new Date(now.getTime() - SYNTHESIS_WINDOW_DAYS * 24 * 3600 * 1000);
    const rows = await db
      .select({
        headline: events.headline,
        template: events.whyItMattersTemplate,
        genericCommentary: events.genericCommentary,
        whyItMatters: events.whyItMatters,
        publishedAt: events.publishedAt,
        url: events.primarySourceUrl,
        corroborationCount: sql<number>`count(${eventSources.id})::int`,
      })
      .from(events)
      .innerJoin(eventSources, eq(eventSources.eventId, events.id))
      .where(
        and(
          eq(events.sourceType, "ingested"),
          eq(events.sector, SUPPLY_CHAIN_SECTOR),
          gt(events.createdAt, since),
        ),
      )
      .groupBy(events.id)
      .having(sql`count(${eventSources.id}) >= ${MIN_CORROBORATION}`);
    return rows.map((r) => ({
      headline: r.headline,
      template: r.template,
      genericCommentary: r.genericCommentary,
      whyItMatters: r.whyItMatters,
      corroborationCount: Number(r.corroborationCount),
      publishedAt:
        r.publishedAt instanceof Date
          ? r.publishedAt.toISOString()
          : (r.publishedAt as string | null),
      url: r.url,
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
    const since = new Date(now.getTime() - DEDUP_WINDOW_DAYS * 24 * 3600 * 1000);
    const rows = await db
      .select({ externalId: ingestionCandidates.externalId })
      .from(ingestionCandidates)
      .innerJoin(
        ingestionSources,
        eq(ingestionCandidates.ingestionSourceId, ingestionSources.id),
      )
      .where(
        and(
          eq(ingestionSources.slug, SUPPLY_CHAIN_SYNTHESIS_SLUG),
          gt(ingestionCandidates.discoveredAt, since),
        ),
      );
    return new Set(rows.map((r) => r.externalId));
  } catch {
    return new Set();
  }
}

async function defaultAuthorPost(
  inputs: SupplyChainSynthesisInputs,
  haiku?: HaikuClientDeps,
): Promise<AuthorOutcome> {
  const prompt = buildSupplyChainSynthesisPrompt(inputs);
  const result = await callHaikuForCommentary(prompt, haiku, {
    assistantPrefill: SUPPLY_CHAIN_SYNTHESIS_ASSISTANT_PREFILL,
    maxTokens: SUPPLY_CHAIN_SYNTHESIS_MAX_TOKENS,
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
  const validated = SupplyChainSynthesisOutputSchema.safeParse(parsed);
  return validated.success
    ? { status: "authored", output: validated.data }
    : { status: "error", reason: "schema_invalid" };
}

export function createSupplyChainSynthesisGenerator(
  deps: SupplyChainSynthesisDeps = {},
): NativeGenerator {
  const discover = deps.discover ?? defaultDiscover;
  const existingExternalIds =
    deps.existingExternalIds ?? defaultExistingExternalIds;
  const authorPost = deps.authorPost ?? defaultAuthorPost;

  return {
    slug: SUPPLY_CHAIN_SYNTHESIS_SLUG,
    async generate(ctx: NativeGeneratorContext): Promise<NativeCandidate[]> {
      const now = ctx.now();
      const emit = ctx.onDiagnostic;
      const isoWeek = isoWeekOf(now);
      const since = new Date(
        now.getTime() - SYNTHESIS_WINDOW_DAYS * 24 * 3600 * 1000,
      );
      const dateRangeLabel = dateRangeLabelOf(since, now);

      const rows = await discover(now);
      const qualified = qualifyAndSort(rows);
      const already = await existingExternalIds(now);

      emit?.({
        stage: "discover",
        identifier: "supply-chain:semis",
        decision: qualified.length >= MIN_EVENTS ? "pass" : "reject",
        reason: qualified.length >= MIN_EVENTS ? null : "too_few_events",
        detail:
          qualified.length >= MIN_EVENTS
            ? undefined
            : `${qualified.length} corroborated event(s) < ${MIN_EVENTS}`,
        signals: {
          sector: SUPPLY_CHAIN_SECTOR,
          corroborated_events: qualified.length,
          week: isoWeek,
        },
      });
      if (qualified.length < MIN_EVENTS) return [];

      const externalId = supplyChainSynthesisExternalId(isoWeek);
      if (already.has(externalId)) {
        emit?.({
          stage: "qualify",
          identifier: externalId,
          decision: "reject",
          reason: "already_posted",
          signals: { sector: SUPPLY_CHAIN_SECTOR, week: isoWeek },
        });
        return [];
      }
      emit?.({
        stage: "qualify",
        identifier: externalId,
        decision: "pass",
        reason: null,
        signals: {
          sector: SUPPLY_CHAIN_SECTOR,
          corroborated_events: qualified.length,
          week: isoWeek,
        },
      });

      const contextEvents = qualified.slice(0, MAX_EVENTS_IN_CONTEXT);
      const eventInputs: SupplyChainEventInput[] = contextEvents.map((e) => ({
        headline: e.headline,
        accessibleThesis: accessibleThesisOf(e),
        corroborationCount: e.corroborationCount,
        publishedAt: e.publishedAt,
      }));
      const inputs: SupplyChainSynthesisInputs = {
        eventCount: qualified.length,
        dateRangeLabel,
        events: eventInputs,
      };

      const outcome = await authorPost(inputs, deps.haiku);
      emit?.({
        stage: "author",
        identifier: externalId,
        decision: outcome.status === "authored" ? "pass" : "reject",
        reason: outcome.status === "authored" ? null : outcome.reason,
        detail:
          outcome.status === "authored"
            ? outcome.output.headline
            : `${outcome.status}: ${outcome.reason}`,
        signals: {
          sector: SUPPLY_CHAIN_SECTOR,
          corroborated_events: qualified.length,
          week: isoWeek,
        },
      });
      if (outcome.status !== "authored") return [];
      const post = outcome.output;

      return [
        {
          externalId,
          url: contextEvents[0]!.url,
          headline: post.headline,
          body: post.body,
          sector: SUPPLY_CHAIN_SECTOR,
          summary: `Semiconductor supply-chain synthesis — ${qualified.length} corroborated event(s), ${dateRangeLabel}.`,
          rawPayload: {
            generator: "supply-chain-synthesis",
            sector: SUPPLY_CHAIN_SECTOR,
            iso_week: isoWeek,
            date_range: dateRangeLabel,
            event_count: qualified.length,
            events: contextEvents.map((e) => ({
              headline: e.headline,
              url: e.url,
              corroboration_count: e.corroborationCount,
              published_at: e.publishedAt,
            })),
          },
        },
      ];
    },
  };
}

// Default instance registered in generators/index.ts.
export const supplyChainSynthesisGenerator = createSupplyChainSynthesisGenerator();
