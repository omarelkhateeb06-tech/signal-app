// Belief-match service — pure logic for the "Reconsider" ritual.
//
// Hybrid "loud + radar": given one of the reader's working beliefs and a short
// list of the week's developments, ask Haiku to pick the SINGLE most relevant
// development and classify how it bears on the belief:
//
//   contradicts — genuine refutation (the loud signal; the original behavior)
//   pressures   — real tension, not refutation
//   supports    — confirming evidence
//   watch       — adjacent, not yet moving the belief
//
// The first matcher was contradiction-only, so it stayed silent most weeks for
// long-horizon beliefs and read as dead. The radar always returns a pulse —
// but stays honest: "contradicts" must be earned, and "none" is returned when
// nothing is even tangentially relevant. No DB, no Redis — the controller owns
// persistence and the per-week cache.
//
// Discipline: the parser fails closed. Any parse/shape error, an empty read,
// or a missing/out-of-range event index → null (no signal), never a fabricated
// one.

import { z } from "zod";
import {
  callHaikuForBeliefMatch,
  type BeliefMatchClientDeps,
} from "./beliefMatchClient";

// The four stored relevance classes (the matcher may also answer "none", which
// is a no-signal sentinel and never persisted). Mirrors the CHECK constraint in
// migration 0068 and the Drizzle column default.
export const BELIEF_RELEVANCE = [
  "contradicts",
  "pressures",
  "supports",
  "watch",
] as const;
export type BeliefRelevance = (typeof BELIEF_RELEVANCE)[number];

export interface BeliefMatchEvent {
  id: string;
  headline: string;
  // Short gist — generic_commentary preferred, why_it_matters fallback;
  // the controller resolves and trims this before handing it over.
  gist: string;
}

export interface BeliefMatchInput {
  belief: {
    statement: string;
    sector: string | null;
    // The reader's explicit falsifier (Tripwire positions, migration 0069).
    // When present it's the sharpest signal: a development that satisfies it
    // leans hard toward "contradicts". Optional — the weekly path and
    // pre-position beliefs omit it.
    whatWouldBreakIt?: string | null;
  };
  events: BeliefMatchEvent[];
}

export interface BeliefMatchVerdict {
  // 1-based index into the input events of the single most relevant
  // development. Always present — a signal with no event is dropped upstream.
  eventIndex: number;
  relevance: BeliefRelevance;
  // The directional read: what this development means for the belief, in the
  // direction the relevance implies.
  read: string;
  // The honest counter-view (may be empty).
  dissent: string;
}

export interface BeliefMatchServiceDeps {
  client?: BeliefMatchClientDeps;
}

export const BELIEF_MATCH_SYSTEM_PROMPT = [
  "You are a sharp, skeptical domain analyst for SIGNAL, an intelligence product for professionals in AI, finance, and semiconductors.",
  "A reader has stated a working belief — a forward-looking assumption they are betting on. Given this week's developments in their field, find the SINGLE development most relevant to that belief and judge how it bears on it.",
  "Classify the relationship with exactly one label:",
  '- "contradicts": genuine evidence the belief is wrong or weakening. Reserve this for real refutation, not mild tension.',
  '- "pressures": real tension — it raises the bar for the belief to hold, or cuts against it, but does not refute it.',
  '- "supports": evidence the belief is holding or strengthening.',
  '- "watch": adjacent and worth tracking, but it does not yet move the belief either way.',
  'Pick the most relevant development and classify it honestly. Most weeks the honest label is "pressures", "supports", or "watch" — "contradicts" is rare and must be earned. Never inflate a relationship to seem useful: a product that cries wolf is worthless, and so is one that fakes confirmation.',
  'Return "none" ONLY if not a single development is even tangentially relevant to the belief.',
  "Write plainly and specifically — name the development and the mechanism. No hype, no hedging, no filler.",
].join("\n");

/**
 * Build the user prompt: the belief + the week's developments, with a strict
 * JSON-only output contract. Exported for unit testing the prompt shape.
 */
export function buildBeliefMatchPrompt(input: BeliefMatchInput): string {
  const { belief, events } = input;
  const sector = belief.sector ? belief.sector : "general";
  const falsifier = belief.whatWouldBreakIt?.trim();
  const eventBlock = events
    .map((e, i) => `${i + 1}. ${e.headline} — ${e.gist}`)
    .join("\n");

  return [
    "THE READER'S BELIEF:",
    `"${belief.statement}" (sector: ${sector})`,
    ...(falsifier
      ? [`The reader says this belief is proven wrong if: ${falsifier}`]
      : []),
    "",
    "THIS WEEK'S DEVELOPMENTS:",
    eventBlock,
    "",
    "Pick the single most relevant development to this belief and classify how it bears on it.",
    "Respond with ONLY a JSON object — no prose, no code fence:",
    '{"relevance": "contradicts" | "pressures" | "supports" | "watch" | "none", "event_index": <1-based number of the chosen development, or null when relevance is "none">, "read": "<1-2 sentences: what this development means for the belief, in the direction the relevance implies>", "dissent": "<one honest sentence of the counter-view — for contradicts/pressures, the strongest case the belief still holds; for supports, the caveat against over-updating; for watch, why it is not decisive yet>"}',
  ].join("\n");
}

const VerdictSchema = z.object({
  relevance: z.enum(["contradicts", "pressures", "supports", "watch", "none"]),
  event_index: z.number().int().positive().nullable().optional(),
  read: z.string().optional().default(""),
  dissent: z.string().optional().default(""),
});

// Pull the first JSON object out of the model text (tolerates an accidental
// code fence or leading prose), then validate. Returns null on any failure.
function parseVerdict(text: string): z.infer<typeof VerdictSchema> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    const result = VerdictSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/**
 * Judge one belief against the week's developments. Returns the radar verdict
 * (most-relevant development + relevance + read + dissent), or null when there
 * is no signal — "none", no events, or any failure mode (client error, empty
 * body, unparseable output, empty read, missing/out-of-range index). Never
 * throws — failing closed is correct here (silence beats a false alarm).
 */
export async function matchBeliefAgainstEvents(
  input: BeliefMatchInput,
  deps: BeliefMatchServiceDeps = {},
): Promise<BeliefMatchVerdict | null> {
  if (input.events.length === 0) return null;

  const userPrompt = buildBeliefMatchPrompt(input);
  const result = await callHaikuForBeliefMatch(
    BELIEF_MATCH_SYSTEM_PROMPT,
    userPrompt,
    deps.client,
  );
  if (!result.ok) return null;

  const verdict = parseVerdict(result.text);
  if (!verdict || verdict.relevance === "none") return null;

  const read = verdict.read.trim();
  if (read.length === 0) return null; // classified but no substance → drop

  // A radar signal must point at a specific development; a missing or
  // out-of-range index means we can't tie it to a card, so drop it (fail
  // closed) rather than surface a sourceless read.
  const idx = verdict.event_index ?? null;
  if (idx == null || idx < 1 || idx > input.events.length) return null;

  return {
    eventIndex: idx,
    relevance: verdict.relevance,
    read,
    dissent: verdict.dissent.trim(),
  };
}

/**
 * ISO-8601 week key, e.g. "2026-W25". Used to scope challenges to a week and
 * to dedup the matcher. Pure (takes the date); the controller passes
 * `new Date()`.
 */
export function isoWeekKey(date: Date): string {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const day = d.getUTCDay() || 7; // Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - day); // Thursday of this ISO week
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
  );
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
