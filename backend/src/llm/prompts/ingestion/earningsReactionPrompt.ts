// Phase 12n.3 — SEC EDGAR earnings/filing-reaction native-post prompt.
//
// Pure prompt-construction. No I/O, no DB, no mutable state. The earnings
// reaction generator (generators/earningsReaction.ts) calls this once per
// qualifying EDGAR event in the 48h window, hands the result to
// `callHaikuForCommentary` with the `{` prefill, parses + Zod-validates the
// model's JSON `{headline, body}`, and builds a NativeCandidate from it.
//
// Architecture note (why this is per-filing, not synthesis):
// an earnings/filing reaction is time-sensitive and entity-specific — the
// editorial value is "here is the ONE number in <Company>'s print that moved
// the thesis," authored fresh off a single filing. Unlike the arXiv / HN
// synthesis generators (one post across many signals), this is one post per
// material filing. The accessible-tier thesis SIGNAL already generated for
// the event IS the distilled "what mattered"; this prompt reframes it as a
// sharp market-reaction read, not a re-summary.
//
// This is NOT fact extraction and NOT a reproduction of the filing text — it
// AUTHORS an original editorial read from the thesis SIGNAL already produced.
//
// Treatment 1 — hook-first, four beats, adapted for a filing reaction:
//   HOOK      — "<Company>'s <period> print had one number that mattered:
//               <specific figure or signal>."
//   SPECIFICS — what the number was, how it compared to expectation / prior
//               period, which other entities it implicates.
//   STAKES    — what it means for the sector thesis (AI capex, semis demand,
//               rate sensitivity — whatever the filing touches).
//   SOURCE    — "<Company> SEC filing via SIGNAL EDGAR feed."

import type { Sector } from "../../../jobs/ingestion/relevanceSeam";

// One qualifying EDGAR event's distilled signal. `company` is the best-known
// filer identity (event primary_source_name, falling back to null when the
// generator couldn't resolve one — the model then infers it from headline +
// thesis). `accessibleThesis` is the already-enriched "one thing that
// mattered" distillation.
export interface EarningsReactionInputs {
  sector: Sector;
  company: string | null;
  headline: string;
  accessibleThesis: string;
  filingDate: string | null; // ISO date, for recency + period framing
  sourceName: string; // for the SOURCE beat, e.g. "SEC EDGAR"
}

export const EARNINGS_REACTION_MAX_TOKENS = 1024;
export const EARNINGS_REACTION_ASSISTANT_PREFILL = "{";

const SECTOR_LABEL: Record<Sector, string> = {
  ai: "AI",
  finance: "finance",
  semiconductors: "semiconductor",
};

const SECTOR_AUDIENCE: Record<Sector, string> = {
  ai: "AI researchers and ML engineers",
  finance: "finance and markets professionals",
  semiconductors: "semiconductor engineers and analysts",
};

const SYSTEM_INSTRUCTION = (sector: Sector): string =>
  [
    `You are a senior editor for a professional intelligence feed read by ${SECTOR_AUDIENCE[sector]}. You write short, original "native posts." Today's signal is a fresh SEC filing SIGNAL ingested from EDGAR — a ${SECTOR_LABEL[sector]}-relevant company's disclosure — already distilled to a one-sentence "why it matters" thesis.`,
    "",
    "Your job is to write the market-reaction read: name the ONE number or disclosure in this filing that actually moves the thesis, and say what it means. Not a recap of the filing — the single load-bearing figure and its consequence. A filing reaction lives or dies on specificity: a real number, a real comparison (versus expectation, versus the prior period), a real downstream implication.",
    "",
    "You are given the company (when resolved), the event headline, and the distilled accessible thesis — NOT the full filing, the tables, or the transcript. Do not pretend to have read the filing. Write from the thesis and what you genuinely know about the company and sector. Do not invent numbers that are not in the thesis or headline.",
    "",
    "These are TIME-SENSITIVE. Only write when there is a clear, material financial signal. DECLINE if the filing is administrative or carries no material new data — a proxy statement, a routine form amendment, an 8-K with no substantive disclosure, a filing whose thesis names no concrete figure or shift. A manufactured reaction to a non-event is worse than none. To decline, return exactly: {\"skip\": true, \"reason\": \"<short phrase, e.g. no-material-signal>\"}.",
    "",
    "When you write, return a JSON object with exactly two fields:",
    '  - "headline": string — a sharp, specific headline naming the number that mattered. No clickbait, no colon-subtitle cliché, no trailing punctuation.',
    '  - "body": string — a single editorial paragraph, 90 to 190 words, plain text (no Markdown, no bullets, no headers).',
    "",
    "Structure the body in four beats, written as flowing prose — never label them:",
    "  1. HOOK — name the company, the period, and the one number that mattered in the first sentence. Not \"the company reported earnings.\"",
    "  2. SPECIFICS — what the number was, how it compared to expectation or the prior period, and which other entities (suppliers, customers, competitors) it implicates.",
    "  3. STAKES — the non-obvious read: what this signals for the sector thesis (AI capex, semis demand, rate sensitivity — whatever the filing touches).",
    "  4. SOURCE — close plainly, naming the filer: \"<Company> SEC filing via SIGNAL EDGAR feed.\"",
    "",
    "Hard quality bar — a post that fails any of these should not be written:",
    "  - Say ONE thing. One number, one consequence, defended.",
    "  - Lead with the load-bearing figure. Cut throat-clearing. Banned openers include \"In today's fast-paced world\", \"In the ever-evolving landscape\", and any variation that delays the point.",
    "  - Surface the NON-OBVIOUS read. If the body merely restates the headline, you have failed. Tell the reader what the number MEANS for the sector.",
    "  - No hype adjectives doing an argument's work. Earn significance with a specific.",
    "",
    'Output ONLY the JSON object (either the skip object or the {headline, body} object). No preamble, no Markdown fencing, no commentary. Begin your response with "{".',
  ].join("\n");

export function buildEarningsReactionPrompt(inputs: EarningsReactionInputs): string {
  const lines: string[] = [
    SYSTEM_INSTRUCTION(inputs.sector),
    "",
    "---",
    "",
    `Sector: ${SECTOR_LABEL[inputs.sector]}`,
    `Company: ${inputs.company ?? "(unresolved — infer from the headline and thesis)"}`,
    `Filing date: ${inputs.filingDate ? inputs.filingDate.slice(0, 10) : "(unknown)"}`,
    `Source: ${inputs.sourceName}`,
    "",
    `Event headline: ${inputs.headline}`,
    `Distilled thesis (what mattered): ${inputs.accessibleThesis}`,
    "",
    "---",
    "",
    "Decide: decline (skip) or write the reaction. Return JSON only.",
  ];
  return lines.join("\n");
}
