// Phase 12n.4 — cross-sector causal-chain native generator.
//
// AUTHORS one native post per run naming the CAUSAL CHAIN connecting two
// sectors over the last 48 hours. The differentiating content no RSS feed
// produces: how a development in one sector (a Fed hold, a chip-capex cut, a
// model release) propagates into another and lands on the reader's desk.
//
//   DISCOVER  ingested events from the last 48h whose PRIMARY source has
//             quality_score ≥ 7 (the editorial floor), joined events →
//             event_sources(role='primary') → ingestion_sources. The event's
//             own `accessible` tier thesis IS the distilled signal.
//   QUALIFY   the window must contain ≥1 qualifying event in each of two
//             DIFFERENT sectors. Of the qualifying sector pairs, the strongest
//             (most combined events) is chosen. Dedup by daily external_id
//             `cross-sector-chain:{sectorA}-{sectorB}:{YYYY-MM-DD}` (sectors
//             alphabetical) so a pair is posted at most once per UTC day.
//   AUTHOR    hand the top few events from each sector to Haiku, which names
//             the causal chain (one call/run). The model DECLINES when no
//             genuine mechanism links the sectors. The standard 3-tier
//             enrichment seam then runs on the authored body.
//
// Cadence: daily if a qualifying cross-sector pair exists; skip the day if
// not. Cap 1 post/run — one chain, the strongest link of the day.
//
// Slug `cross-sector-chain-native` — seeded by migration 0042. The CLI
// dry-run tolerates a missing row; a real run requires it.

import {
  buildCrossSectorChainPrompt,
  CROSS_SECTOR_CHAIN_ASSISTANT_PREFILL,
  CROSS_SECTOR_CHAIN_MAX_TOKENS,
  type ChainEventInput,
  type CrossSectorChainInputs,
} from "../../../llm/prompts/ingestion/crossSectorChainPrompt";
import { callHaikuForCommentary, type HaikuClientDeps } from "../../../services/haikuCommentaryClient";
import { parseTierTemplate } from "../../../utils/depthVariants";
import { VALID_SECTORS, type Sector } from "../relevanceSeam";
import type { NativeCandidate, NativeGenerator, NativeGeneratorContext } from "./types";
import { z } from "zod";

// ---- Config ----

export const CROSS_SECTOR_CHAIN_SLUG = "cross-sector-chain-native";

// One chain per run — the single strongest cross-sector link of the day.
export const MAX_CHAIN_POSTS_PER_RUN = 1;

// Trailing window the chain reasons over. 48h per the 12n.4 spec — recent
// enough that "what you can do today" framing stays honest.
export const CHAIN_WINDOW_HOURS = 48;

// Editorial floor on the PRIMARY source's quality_score for an event to count
// toward a sector's qualifying set. Matches the 12n.4 spec's ≥7 trigger.
export const MIN_QUALITY_SCORE = 7;

// A sector qualifies for a pair with at least this many events in the window.
export const MIN_EVENTS_PER_SECTOR = 1;

// Cap on events per sector fed to the prompt — the newest few carry the
// freshest causal signal; beyond that the model loses the thread.
export const MAX_EVENTS_IN_CONTEXT = 3;

// Dedup look-back for already-authored daily external_ids. Two days covers a
// late re-run that crosses the UTC midnight from the window it reasoned over.
export const DEDUP_WINDOW_DAYS = 2;

// Canonical sector-pair priority. A pair is keyed alphabetically (so the dedup
// external_id is stable regardless of which sector "led"); this list is the
// tiebreak order when two pairs have equal combined event counts.
export const CANONICAL_PAIRS: readonly (readonly [Sector, Sector])[] = [
  ["ai", "semiconductors"],
  ["ai", "finance"],
  ["finance", "semiconductors"],
];

// ---- Model output contract ----

const CrossSectorChainOutputSchema = z
  .object({
    headline: z.string().min(8).max(200),
    body: z.string().min(200).max(2400),
  })
  .strict();

export type CrossSectorChainOutput = z.infer<typeof CrossSectorChainOutputSchema>;

export type AuthorOutcome =
  | { status: "authored"; output: CrossSectorChainOutput }
  | { status: "skipped"; reason: string }
  | { status: "error"; reason: string };

// ---- Discovery shapes ----

// One qualifying ingested event row, as the discover dep returns it.
export interface ChainEventRow {
  sector: string;
  headline: string;
  template: string | null; // events.why_it_matters_template (TierTemplate JSON)
  genericCommentary: string | null;
  whyItMatters: string;
  publishedAt: string | null;
  url: string; // events.primary_source_url
  qualityScore: number; // primary source's ingestion_sources.quality_score
}

// ---- Pure helpers (exported for tests) ----

// Distill a row to its one-sentence "why it matters". Prefers the per-tier
// `accessible.thesis`; falls back to generic_commentary, then why_it_matters.
export function accessibleThesisOf(row: ChainEventRow): string {
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

// UTC calendar-day key (YYYY-MM-DD) for the daily dedup external_id.
export function utcDateKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

// Daily, sector-ordered external_id. Sectors are sorted alphabetically so the
// key is identical regardless of which sector the chain "starts" from.
export function chainExternalId(
  sectorA: Sector,
  sectorB: Sector,
  now: Date,
): string {
  const [first, second] = [sectorA, sectorB].sort();
  return `cross-sector-chain:${first}-${second}:${utcDateKey(now)}`;
}

// Group qualifying rows by scoped sector, newest first. Out-of-scope sectors
// are dropped. (Every row here already cleared the quality floor at the DB.)
export function groupBySector(rows: ChainEventRow[]): Map<Sector, ChainEventRow[]> {
  const byRecency = (a: ChainEventRow, b: ChainEventRow): number => {
    const at = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const bt = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    return bt - at;
  };
  const grouped = new Map<Sector, ChainEventRow[]>();
  for (const row of rows) {
    if (!isSector(row.sector)) continue;
    const list = grouped.get(row.sector) ?? [];
    list.push(row);
    grouped.set(row.sector, list);
  }
  for (const list of grouped.values()) list.sort(byRecency);
  return grouped;
}

// Choose the strongest qualifying sector pair from grouped events, or null if
// no two sectors each clear MIN_EVENTS_PER_SECTOR. "Strongest" = most combined
// events; ties broken by CANONICAL_PAIRS order. The returned tuple is in
// CANONICAL_PAIRS orientation (not alphabetical) so the prompt reads naturally;
// the dedup key re-sorts alphabetically.
export function selectBestPair(
  grouped: Map<Sector, ChainEventRow[]>,
): readonly [Sector, Sector] | null {
  let best: { pair: readonly [Sector, Sector]; total: number } | null = null;
  for (const pair of CANONICAL_PAIRS) {
    const a = grouped.get(pair[0]) ?? [];
    const b = grouped.get(pair[1]) ?? [];
    if (a.length < MIN_EVENTS_PER_SECTOR || b.length < MIN_EVENTS_PER_SECTOR) {
      continue;
    }
    const total = a.length + b.length;
    // Strictly-greater keeps CANONICAL_PAIRS order as the tiebreak (earlier
    // pairs win equal totals).
    if (!best || total > best.total) {
      best = { pair, total };
    }
  }
  return best?.pair ?? null;
}

// ---- Generator deps (injectable for tests) ----

export interface CrossSectorChainDeps {
  discover?: (now: Date) => Promise<ChainEventRow[]>;
  existingExternalIds?: (now: Date) => Promise<Set<string>>;
  haiku?: HaikuClientDeps;
  authorPost?: (
    inputs: CrossSectorChainInputs,
    haiku?: HaikuClientDeps,
  ) => Promise<AuthorOutcome>;
}

// Ingested events in the window whose primary source clears the quality floor.
// Joins events → event_sources(role='primary') → ingestion_sources for the
// per-source quality_score. Fail-CLOSED: any DB error returns [].
async function defaultDiscover(now: Date): Promise<ChainEventRow[]> {
  try {
    const [{ db }, schema, drizzle] = await Promise.all([
      import("../../../db"),
      import("../../../db/schema"),
      import("drizzle-orm"),
    ]);
    const { events, eventSources, ingestionSources } = schema;
    const { and, eq, gt, gte } = drizzle;
    const since = new Date(now.getTime() - CHAIN_WINDOW_HOURS * 3600 * 1000);
    const rows = await db
      .select({
        sector: events.sector,
        headline: events.headline,
        template: events.whyItMattersTemplate,
        genericCommentary: events.genericCommentary,
        whyItMatters: events.whyItMatters,
        publishedAt: events.publishedAt,
        url: events.primarySourceUrl,
        qualityScore: ingestionSources.qualityScore,
      })
      .from(events)
      .innerJoin(
        eventSources,
        and(eq(eventSources.eventId, events.id), eq(eventSources.role, "primary")),
      )
      .innerJoin(
        ingestionSources,
        eq(ingestionSources.id, eventSources.ingestionSourceId),
      )
      .where(
        and(
          eq(events.sourceType, "ingested"),
          gt(events.createdAt, since),
          gte(ingestionSources.qualityScore, MIN_QUALITY_SCORE),
        ),
      );
    return rows.map((r) => ({
      sector: r.sector,
      headline: r.headline,
      template: r.template,
      genericCommentary: r.genericCommentary,
      whyItMatters: r.whyItMatters,
      publishedAt:
        r.publishedAt instanceof Date
          ? r.publishedAt.toISOString()
          : (r.publishedAt as string | null),
      url: r.url,
      qualityScore: r.qualityScore,
    }));
  } catch {
    return [];
  }
}

// External IDs this generator's source already produced in the dedup window.
// Fail-OPEN: any DB error returns an empty set (the per-source unique
// constraint still blocks a duplicate row on insert).
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
          eq(ingestionSources.slug, CROSS_SECTOR_CHAIN_SLUG),
          gt(ingestionCandidates.discoveredAt, since),
        ),
      );
    return new Set(rows.map((r) => r.externalId));
  } catch {
    return new Set();
  }
}

async function defaultAuthorPost(
  inputs: CrossSectorChainInputs,
  haiku?: HaikuClientDeps,
): Promise<AuthorOutcome> {
  const prompt = buildCrossSectorChainPrompt(inputs);
  const result = await callHaikuForCommentary(prompt, haiku, {
    assistantPrefill: CROSS_SECTOR_CHAIN_ASSISTANT_PREFILL,
    maxTokens: CROSS_SECTOR_CHAIN_MAX_TOKENS,
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
  const validated = CrossSectorChainOutputSchema.safeParse(parsed);
  return validated.success
    ? { status: "authored", output: validated.data }
    : { status: "error", reason: "schema_invalid" };
}

// Human label for the SOURCE beat / summary.
function dateLabelOf(now: Date): string {
  return now.toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function createCrossSectorChainGenerator(
  deps: CrossSectorChainDeps = {},
): NativeGenerator {
  const discover = deps.discover ?? defaultDiscover;
  const existingExternalIds =
    deps.existingExternalIds ?? defaultExistingExternalIds;
  const authorPost = deps.authorPost ?? defaultAuthorPost;

  return {
    slug: CROSS_SECTOR_CHAIN_SLUG,
    async generate(ctx: NativeGeneratorContext): Promise<NativeCandidate[]> {
      const now = ctx.now();
      const emit = ctx.onDiagnostic;

      const rows = await discover(now);
      const grouped = groupBySector(rows);
      const pair = selectBestPair(grouped);

      if (!pair) {
        emit?.({
          stage: "discover",
          identifier: "cross-sector-chain",
          decision: "reject",
          reason: "no_qualifying_pair",
          detail: `sectors with ≥${MIN_EVENTS_PER_SECTOR} qualifying event: ${[...grouped.keys()].join(",") || "none"}`,
          signals: {
            ai: (grouped.get("ai") ?? []).length,
            finance: (grouped.get("finance") ?? []).length,
            semiconductors: (grouped.get("semiconductors") ?? []).length,
          },
        });
        return [];
      }

      const [sectorA, sectorB] = pair;
      const eventsA = grouped.get(sectorA) ?? [];
      const eventsB = grouped.get(sectorB) ?? [];
      emit?.({
        stage: "discover",
        identifier: `${sectorA}+${sectorB}`,
        decision: "pass",
        reason: null,
        signals: { a: eventsA.length, b: eventsB.length },
      });

      const externalId = chainExternalId(sectorA, sectorB, now);
      const already = await existingExternalIds(now);
      if (already.has(externalId)) {
        emit?.({
          stage: "qualify",
          identifier: externalId,
          decision: "reject",
          reason: "already_posted",
          signals: { pair: `${sectorA}+${sectorB}` },
        });
        return [];
      }
      emit?.({
        stage: "qualify",
        identifier: externalId,
        decision: "pass",
        reason: null,
        signals: { a: eventsA.length, b: eventsB.length },
      });

      const contextA = eventsA.slice(0, MAX_EVENTS_IN_CONTEXT);
      const contextB = eventsB.slice(0, MAX_EVENTS_IN_CONTEXT);
      const toInput = (sector: Sector) => (e: ChainEventRow): ChainEventInput => ({
        headline: e.headline,
        accessibleThesis: accessibleThesisOf(e),
        sector,
        publishedAt: e.publishedAt,
      });
      const dateLabel = dateLabelOf(now);
      const inputs: CrossSectorChainInputs = {
        sectorA,
        sectorB,
        dateLabel,
        windowLabel: `the last ${CHAIN_WINDOW_HOURS} hours`,
        eventCountA: eventsA.length,
        eventCountB: eventsB.length,
        eventsA: contextA.map(toInput(sectorA)),
        eventsB: contextB.map(toInput(sectorB)),
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
        signals: { pair: `${sectorA}+${sectorB}` },
      });
      if (outcome.status !== "authored") return [];
      const post = outcome.output;

      // Lead the post's source pointer with the A-sector originating event.
      const candidate: NativeCandidate = {
        externalId,
        url: contextA[0]!.url,
        headline: post.headline,
        body: post.body,
        // The post spans two sectors; tag it to the originating (A) sector so
        // it surfaces in that sector's feed. A-sector is the chain's root.
        sector: sectorA,
        summary: `Cross-sector chain — ${sectorA} ↔ ${sectorB}, ${dateLabel}.`,
        rawPayload: {
          generator: "cross-sector-chain",
          sector_a: sectorA,
          sector_b: sectorB,
          date: utcDateKey(now),
          event_count_a: eventsA.length,
          event_count_b: eventsB.length,
          events_a: contextA.map((e) => ({ headline: e.headline, url: e.url })),
          events_b: contextB.map((e) => ({ headline: e.headline, url: e.url })),
        },
      };

      return [candidate];
    },
  };
}

// Default instance registered in generators/index.ts.
export const crossSectorChainGenerator = createCrossSectorChainGenerator();
