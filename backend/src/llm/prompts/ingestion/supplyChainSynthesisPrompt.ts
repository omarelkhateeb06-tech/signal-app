// Phase 12n.3 — semiconductor supply-chain synthesis native-post prompt.
//
// Pure prompt-construction. No I/O, no DB, no mutable state. The supply-chain
// synthesis generator (generators/supplyChainSynthesis.ts) calls this once per
// run (semis only), hands the result to `callHaikuForCommentary` with the `{`
// prefill, parses + Zod-validates the model's JSON `{headline, body}`, and
// builds a NativeCandidate from it.
//
// Architecture note (why this is SYNTHESIS, and why CORROBORATED events):
// the editorial value here is the non-obvious CONNECTION across several
// independently-reported supply-chain events — "the real constraint isn't the
// obvious thing, it's the second-order bottleneck." Each event already
// shipped as its own ingested story; the post's value is naming the through-
// line. The generator feeds only CORROBORATED events (≥2 sources) so the
// synthesis is grounded in multiply-reported facts, not a single outlet's take.
//
// This is NOT fact extraction and NOT a reproduction of source prose — it
// AUTHORS an original editorial paragraph from theses SIGNAL already produced.
//
// Treatment 1 — hook-first, four beats, adapted for a bottleneck synthesis:
//   HOOK      — "The real constraint in <situation> isn't <obvious thing> —
//               it's <actual bottleneck>."
//   SPECIFICS — 2-3 of the corroborated events, naming concrete actors
//               (TSMC, ASML, NVIDIA, HBM suppliers) and what each established.
//   STAKES    — the downstream effect: who/what gets squeezed next.
//   SOURCE    — "Synthesized from N corroborated supply-chain events,
//               <date range>."

// One corroborated semis event's distilled signal — the already-generated
// `accessible` thesis plus identity and its corroboration count (number of
// independent sources). The generator assembles up to 5 of these.
export interface SupplyChainEventInput {
  headline: string;
  accessibleThesis: string; // events.why_it_matters_template.accessible.thesis
  corroborationCount: number; // count of event_sources rows (≥2 to qualify)
  publishedAt: string | null; // ISO date, for recency + the date-range beat
}

export interface SupplyChainSynthesisInputs {
  eventCount: number; // total qualifying corroborated events in the window
  dateRangeLabel: string; // human "May 23–30, 2026" for the SOURCE beat
  events: SupplyChainEventInput[]; // up to 5, newest first
}

// Per-call max_tokens. A synthesis post is a short editorial paragraph plus a
// headline + JSON envelope. 1024 leaves comfortable headroom; mid-JSON
// truncation (→ parse error → no post) is strictly worse than spare tokens.
export const SUPPLY_CHAIN_SYNTHESIS_MAX_TOKENS = 1024;

// Assistant-side prefill — biases Haiku toward emitting a JSON object.
export const SUPPLY_CHAIN_SYNTHESIS_ASSISTANT_PREFILL = "{";

const SYSTEM_INSTRUCTION: string = [
  'You are a senior editor for a professional intelligence feed read by semiconductor engineers, supply-chain analysts, and the investors who follow them. You write short, original "native posts" — editorial syntheses of a week\'s signal. Today\'s signal is a set of semiconductor supply-chain events that SIGNAL ingested, each CORROBORATED by two or more independent sources and already distilled to a one-sentence "why it matters" thesis.',
  "",
  "Your job is NOT to summarize the events one by one. The reader can read a list of headlines themselves. Your job is to find the non-obvious CONNECTION across several of them — the real bottleneck. The supply chain is full of obvious constraints (fab capacity, the latest export rule); the editorial value is naming the SECOND-ORDER constraint the obvious story hides. If three events independently point at the same upstream chokepoint — packaging, HBM, a single lithography vendor — that convergence IS the story.",
  "",
  "You are given each event's headline and its distilled accessible thesis only — NOT the full source articles. Do not pretend to have read the sources. Write from the theses and what you genuinely know about the semiconductor supply chain (TSMC, ASML, NVIDIA, the HBM makers, CoWoS packaging, etc.). Do not invent numbers that are not in the theses.",
  "",
  "DECLINE if the events all make the same obvious point — if there is no second-order connection to draw, a forced \"real bottleneck\" framing is worse than none. The whole post is the non-obvious link; if you can't find one, skip. To decline, return exactly: {\"skip\": true, \"reason\": \"<short phrase, e.g. no-nonobvious-connection>\"}.",
  "",
  "When you write, return a JSON object with exactly two fields:",
  '  - "headline": string — a sharp, specific headline naming the real constraint. No clickbait, no colon-subtitle cliché, no trailing punctuation.',
  '  - "body": string — a single editorial paragraph, 90 to 190 words, plain text (no Markdown, no bullets, no headers).',
  "",
  "Structure the body in four beats, written as flowing prose — never label them:",
  '  1. HOOK — name the real constraint in the first sentence: "the real constraint in <situation> isn\'t <obvious thing> — it\'s <actual bottleneck>." Not "several supply-chain stories broke this week."',
  "  2. SPECIFICS — ground the constraint in 2-3 of the actual corroborated events, naming concrete actors (TSMC, ASML, NVIDIA, HBM suppliers) and what each established.",
  "  3. STAKES — the downstream effect: who or what gets squeezed next as a consequence of this bottleneck.",
  '  4. SOURCE — close by naming the basis plainly: "Synthesized from N corroborated supply-chain events, <date range>."',
  "",
  "Hard quality bar — a post that fails any of these should not be written:",
  "  - Say ONE thing. One bottleneck, one consequence, defended. A post that names three unrelated constraints names none.",
  '  - Lead with the load-bearing sentence. Cut every word of throat-clearing. Banned openers include "In today\'s fast-paced world", "In the ever-evolving landscape", and any variation that delays the point.',
  "  - Surface the NON-OBVIOUS connection. If the body merely lists what each event said, you have failed. Tell the reader what the SET means together — the chokepoint they'd otherwise miss.",
  '  - No hype adjectives doing an argument\'s work ("revolutionary", "groundbreaking"). Earn significance with a specific.',
  "",
  'Output ONLY the JSON object (either the skip object or the {headline, body} object). No preamble, no Markdown fencing, no commentary. Begin your response with "{".',
].join("\n");

export function buildSupplyChainSynthesisPrompt(
  inputs: SupplyChainSynthesisInputs,
): string {
  const lines: string[] = [
    SYSTEM_INSTRUCTION,
    "",
    "---",
    "",
    "Sector: semiconductor supply chain",
    `Date range: ${inputs.dateRangeLabel}`,
    `Total qualifying corroborated events: ${inputs.eventCount}`,
    "",
    `The corroborated events (showing ${inputs.events.length}, newest first):`,
  ];
  inputs.events.forEach((e, i) => {
    lines.push(
      `  ${i + 1}. "${e.headline}"${e.publishedAt ? ` (${e.publishedAt.slice(0, 10)})` : ""} — ${e.corroborationCount} sources`,
    );
    lines.push(`     why it matters: ${e.accessibleThesis}`);
  });
  lines.push(
    "",
    "---",
    "",
    "Decide: decline (skip) or write the synthesis. Return JSON only.",
  );
  return lines.join("\n");
}
