// Belief-match service — pure logic for the "Reconsider" ritual.
//
// Given one of the reader's working beliefs and a short list of the week's
// developments, ask Haiku whether any MATERIALLY challenges the belief, and
// if so how the reader's view should update + the informed dissent. No DB,
// no Redis — the controller owns persistence and the per-week cache.
//
// Discipline: strict judging. The product dies if it cries wolf, so the
// prompt forbids manufacturing a contradiction and the parser fails closed
// (any parse/shape error → "no challenge", never a fabricated one).

import { z } from "zod";
import {
  callHaikuForBeliefMatch,
  type BeliefMatchClientDeps,
} from "./beliefMatchClient";

export interface BeliefMatchEvent {
  id: string;
  headline: string;
  // One-line gist — generic_commentary preferred, why_it_matters fallback;
  // the controller resolves this before handing it over.
  gist: string;
}

export interface BeliefMatchInput {
  belief: { statement: string; sector: string | null };
  events: BeliefMatchEvent[];
}

export interface BeliefMatchVerdict {
  // 1-based index into the input events of the single most challenging
  // development, or null when the challenge is not tied to one item.
  eventIndex: number | null;
  howToUpdate: string;
  dissent: string;
}

export interface BeliefMatchServiceDeps {
  client?: BeliefMatchClientDeps;
}

export const BELIEF_MATCH_SYSTEM_PROMPT = [
  "You are a sharp, sceptical domain analyst for SIGNAL, an intelligence product for professionals in AI, finance, and semiconductors.",
  "A reader has stated a working belief. Given recent developments, judge whether any one of them MATERIALLY challenges, contradicts, or should update that belief.",
  "Be strict. Only flag a genuine, material challenge — not loosely-related or merely on-topic news. Most weeks, most beliefs are NOT challenged; saying 'not challenged' is the common, correct answer.",
  "Never invent or inflate a contradiction to seem useful. A product that cries wolf is worthless.",
  "When you do flag one, be specific and plain: how the view should change, and the strongest honest case it still holds. No hype, no hedging.",
].join(" ");

/**
 * Build the user prompt: the belief + the week's developments, with a strict
 * JSON-only output contract. Exported for unit testing the prompt shape.
 */
export function buildBeliefMatchPrompt(input: BeliefMatchInput): string {
  const { belief, events } = input;
  const sector = belief.sector ? belief.sector : "general";
  const eventBlock = events
    .map((e, i) => `${i + 1}. ${e.headline} — ${e.gist}`)
    .join("\n");

  return [
    "THE READER'S BELIEF:",
    `"${belief.statement}" (sector: ${sector})`,
    "",
    "RECENT DEVELOPMENTS:",
    eventBlock,
    "",
    "Does any single development materially challenge, contradict, or warrant updating this belief?",
    "Respond with ONLY a JSON object — no prose, no code fence:",
    '{"challenged": true|false, "event_index": <1-based number of the single most challenging development, or null>, "how_to_update": "<if challenged: 1-2 sentences on how the reader should update their view; else empty>", "dissent": "<if challenged: one sentence of the strongest honest case the belief still holds; else empty>"}',
  ].join("\n");
}

const VerdictSchema = z.object({
  challenged: z.boolean(),
  event_index: z.number().int().positive().nullable().optional(),
  how_to_update: z.string().optional().default(""),
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
 * Judge one belief against the week's developments. Returns a verdict when a
 * material challenge is found, or null otherwise (including every failure
 * mode: client error, empty body, unparseable output, no events). Never
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
  if (!verdict || !verdict.challenged) return null;

  const howToUpdate = verdict.how_to_update.trim();
  if (howToUpdate.length === 0) return null; // challenged but no substance → drop

  // Clamp the event index to the input range; out-of-range → not tied to one.
  const idx = verdict.event_index ?? null;
  const eventIndex =
    idx != null && idx >= 1 && idx <= input.events.length ? idx : null;

  return {
    eventIndex,
    howToUpdate,
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
