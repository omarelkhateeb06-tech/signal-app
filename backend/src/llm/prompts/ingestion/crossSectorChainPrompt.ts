// Phase 12n.4 — cross-sector causal-chain native-post prompt.
//
// Pure prompt-construction. No I/O, no DB, no mutable state. The cross-sector
// chain generator (generators/crossSectorChain.ts) calls this once per run for
// the strongest qualifying sector pair, hands the result to
// `callHaikuForCommentary` with the `{` prefill, parses + Zod-validates the
// model's JSON `{headline, body}`, and builds a NativeCandidate from it.
//
// Architecture note (the differentiating content):
// every RSS feed reports single-sector events. The value SIGNAL adds — and no
// feed produces — is the CONNECTIVE TISSUE between sectors: how a Fed hold
// reshapes semiconductor capex, which reshapes AI-infra cost, which reshapes
// what a builder pays this quarter. This prompt is fed the distilled
// `accessible` theses of the last ~48h of high-quality events in TWO different
// sectors and asked to name the causal chain linking them: event → sector-A
// impact → sector-B impact → what it means for the reader TODAY.
//
// This is NOT a summary of two unrelated events side by side. If there is no
// genuine causal mechanism connecting the sectors' signal, the model DECLINES.
// A manufactured chain is worse than none.
//
// Hook-first, five beats:
//   HOOK   — name the connection: "<sector-A development> is about to move
//            <sector-B>." The one cross-sector link, stated plainly.
//   CHAIN  — the mechanism, link by link: the A-side event, how it propagates
//            to B, the second-order consequence. Real events, real causation.
//   STAKES — what the chain means for the reader's work or portfolio.
//   SOURCE — "Synthesized from N events across <A> and <B>, <date>."
//   ACT    — MANDATORY closing sentence: one concrete thing to do TODAY given
//            the chain (reprice, rehedge, reprioritize, watch a specific
//            number).

import type { Sector } from "../../../jobs/ingestion/relevanceSeam";

// One event's distilled signal feeding the chain — the already-generated
// `accessible` thesis plus identity. The generator assembles up to a few of
// these per sector.
export interface ChainEventInput {
  headline: string;
  accessibleThesis: string; // events.why_it_matters_template.accessible.thesis
  sector: Sector;
  publishedAt: string | null; // ISO date, for recency framing
}

export interface CrossSectorChainInputs {
  sectorA: Sector;
  sectorB: Sector;
  dateLabel: string; // human "May 31, 2026" for the SOURCE beat
  windowLabel: string; // human window, e.g. "the last 48 hours"
  eventCountA: number; // qualifying A-sector events in the window (≥ eventsA.length)
  eventCountB: number; // qualifying B-sector events in the window (≥ eventsB.length)
  eventsA: ChainEventInput[]; // top A-sector events, newest/highest-signal first
  eventsB: ChainEventInput[]; // top B-sector events
}

// Per-call max_tokens. A chain post is a short editorial paragraph plus a
// headline + JSON envelope. 1024 leaves comfortable headroom; the failure mode
// of a tight budget (mid-JSON truncation → parse error → no post) is strictly
// worse than the spare tokens.
export const CROSS_SECTOR_CHAIN_MAX_TOKENS = 1024;

// Assistant-side prefill — biases Haiku toward emitting a JSON object.
export const CROSS_SECTOR_CHAIN_ASSISTANT_PREFILL = "{";

const SECTOR_LABEL: Record<Sector, string> = {
  ai: "AI / machine learning",
  finance: "finance and markets",
  semiconductors: "semiconductors",
};

function buildSystemInstruction(
  sectorA: Sector,
  sectorB: Sector,
): string {
  const a = SECTOR_LABEL[sectorA];
  const b = SECTOR_LABEL[sectorB];
  return [
    `You are a senior editor for a professional intelligence feed covering AI, finance, and semiconductors, read by working professionals who ship, invest, and build. You write short, original "native posts." Today's task is the one thing no single-sector feed can produce: the CAUSAL CHAIN connecting two sectors. You are given the last ~48 hours of high-signal events in ${a} and in ${b}, each distilled to a one-sentence "why it matters" thesis.`,
    "",
    `Your job is to name the through-line BETWEEN the sectors — how a development in one propagates into the other and lands on the reader's desk. The differentiating value is the connective tissue: how a Fed hold reshapes semiconductor capex, which reshapes AI-infra cost, which reshapes what a builder pays this quarter. A reader can find the ${a} story and the ${b} story on their own; what they cannot find anywhere else is the mechanism linking them.`,
    "",
    "You are given each event's headline and its distilled accessible thesis only — NOT the full article. Do not pretend to have read the sources. Write from the theses and what you genuinely know about how these sectors interact. Do not invent numbers that are not in the theses.",
    "",
    "Only WRITE when there is a GENUINE causal mechanism — a real, defensible chain of cause and effect, not a coincidence of timing or a vague thematic rhyme. If the two sectors' signal this window does not actually connect, DECLINE: a manufactured chain is worse than none. To decline, return exactly: {\"skip\": true, \"reason\": \"<short phrase, e.g. no-causal-link>\"}.",
    "",
    "When you write, return a JSON object with exactly two fields:",
    '  - "headline": string — a sharp, specific headline naming the cross-sector link. No clickbait, no colon-subtitle cliché, no trailing punctuation.',
    '  - "body": string — a single editorial paragraph, 100 to 200 words, plain text (no Markdown, no bullets, no headers).',
    "",
    "Structure the body in five beats, written as flowing prose — never label them:",
    `  1. HOOK — state the connection in the first sentence: a ${a} development is about to move ${b} (or vice versa). Name the link, not the two events separately.`,
    "  2. CHAIN — walk the mechanism link by link: the originating event, how it propagates to the other sector, and the second-order consequence. Each link must be a real causal step, grounded in the actual events you were given. This is the load-bearing beat — make the causation explicit.",
    "  3. STAKES — what the chain means concretely for the reader's work or portfolio: the cost that moves, the assumption that breaks, the position that's now exposed.",
    "  4. SOURCE — name the basis plainly: \"Synthesized from N events across <sector A> and <sector B>, <date>.\"",
    "  5. ACT — the MANDATORY closing sentence. End with one concrete, present-tense thing the reader can do TODAY given the chain: a number to reprice against, a hedge to reconsider, a roadmap assumption to revisit, a specific metric to start watching. Specific to THIS chain, never generic. Required; a post without it is incomplete.",
    "",
    "Hard quality bar — a post that fails any of these should not be written:",
    "  - The chain must be CAUSAL, not correlational. If you cannot articulate the mechanism in plain cause-and-effect, decline.",
    "  - Say ONE thing. One chain, defended. Do not braid three loosely-related threads.",
    "  - Lead with the load-bearing sentence. Cut throat-clearing. Banned openers include \"In today's fast-paced world\", \"In the ever-evolving landscape\", and any variation that delays the point.",
    "  - End on action. The closing sentence must give the reader something to DO today, drawn from this specific chain. A post that ends on abstract significance has failed the close.",
    "  - No hype adjectives doing an argument's work (\"revolutionary\", \"groundbreaking\"). Earn significance with a specific.",
    "",
    'Output ONLY the JSON object (either the skip object or the {headline, body} object). No preamble, no Markdown fencing, no commentary. Begin your response with "{".',
  ].join("\n");
}

export function buildCrossSectorChainPrompt(
  inputs: CrossSectorChainInputs,
): string {
  const lines: string[] = [
    buildSystemInstruction(inputs.sectorA, inputs.sectorB),
    "",
    "---",
    "",
    `Sectors to connect: ${SECTOR_LABEL[inputs.sectorA]} ↔ ${SECTOR_LABEL[inputs.sectorB]}`,
    `Window: ${inputs.windowLabel} (as of ${inputs.dateLabel})`,
    "",
    `${SECTOR_LABEL[inputs.sectorA]} events (${inputs.eventCountA} qualifying, showing ${inputs.eventsA.length}, newest first):`,
  ];
  inputs.eventsA.forEach((e, i) => {
    lines.push(
      `  ${i + 1}. "${e.headline}"${e.publishedAt ? ` (${e.publishedAt.slice(0, 10)})` : ""}`,
    );
    lines.push(`     why it matters: ${e.accessibleThesis}`);
  });
  lines.push(
    "",
    `${SECTOR_LABEL[inputs.sectorB]} events (${inputs.eventCountB} qualifying, showing ${inputs.eventsB.length}, newest first):`,
  );
  inputs.eventsB.forEach((e, i) => {
    lines.push(
      `  ${i + 1}. "${e.headline}"${e.publishedAt ? ` (${e.publishedAt.slice(0, 10)})` : ""}`,
    );
    lines.push(`     why it matters: ${e.accessibleThesis}`);
  });
  lines.push(
    "",
    "---",
    "",
    "Decide: decline (skip) if there is no genuine causal link, or write the chain. Return JSON only.",
  );
  return lines.join("\n");
}
