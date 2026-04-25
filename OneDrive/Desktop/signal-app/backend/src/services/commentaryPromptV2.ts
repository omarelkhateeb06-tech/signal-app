// Phase 12d — structured-output prompt for expandable commentary
// (issues #23, #20).
//
// The single Haiku call returns JSON `{ thesis, support }`. Thesis is
// what the reader sees by default; support is revealed by "Go deeper".
// Token budgets per depth are enforced in the prompt and again by the
// post-generation word-count validator (logged, not rejected).
//
// JSON enforcement strategy:
//   1. Prompt instruction ("Return ONLY the JSON object. ...")
//   2. One-shot example showing correct shape (below).
//   3. Assistant prefill: the Anthropic call should be made with the
//      first assistant message preset to `{` so the model continues
//      from inside the JSON object. The prefill literal is exported as
//      `COMMENTARY_PREFILL` so the service-layer wiring uses one
//      source of truth.
//   4. Service-layer parse + retry-once + fallback (in commentaryService).
//
// This module is pure: same shape as commentaryPrompt.ts so unit tests
// can assert verbatim substrings. The 12c prompt module stays in place
// during transition; this v2 will replace it once the service refactor
// lands.

import { BANNED_PHRASES } from "./commentaryFallback";
import type { DepthLevel } from "../db/schema";

// User-facing label used in the prompt. Maps the internal enum
// (accessible | standard | technical) to the product copy
// (Beginner | Standard | Technical) that the brief speaks in.
const DEPTH_LABEL: Record<DepthLevel, string> = {
  accessible: "Beginner",
  standard: "Standard",
  technical: "Technical",
};

// Token budgets per Decision 12d.4. Word counts are targets the model
// should land near; the post-generation validator warns at >20% over.
interface DepthBudget {
  thesisSentences: string; // human-readable range, dropped into the prompt
  thesisWords: number;
  supportSentences: string;
  supportWords: number;
  register: string;
}

const DEPTH_BUDGETS: Record<DepthLevel, DepthBudget> = {
  accessible: {
    thesisSentences: "2 sentences",
    thesisWords: 35,
    supportSentences: "3–4 sentences",
    supportWords: 70,
    register: "plain language, no jargon without an inline gloss",
  },
  standard: {
    thesisSentences: "2 sentences",
    thesisWords: 40,
    supportSentences: "3–5 sentences",
    supportWords: 90,
    register: "domain-fluent, minimal hand-holding",
  },
  technical: {
    thesisSentences: "1–2 sentences",
    thesisWords: 40,
    supportSentences: "4–6 sentences",
    supportWords: 130,
    register: "assumes expert familiarity; precise terminology, named mechanisms, specific numbers",
  },
};

// Word-count budgets exported for the post-generation validator. Kept
// adjacent to the prompt so changes to one are visible against the other.
export interface CommentaryWordBudgets {
  thesis: number;
  support: number;
}

export function getWordBudgets(depth: DepthLevel): CommentaryWordBudgets {
  const b = DEPTH_BUDGETS[depth];
  return { thesis: b.thesisWords, support: b.supportWords };
}

// Assistant-side prefill. The service-layer call to Anthropic should
// include this as the start of the assistant turn. Combined with the
// prompt's "Return ONLY the JSON object" instruction and the one-shot
// example below, JSON parse failures should be rare. Exported here so
// the service wiring and any future prefill-aware test harness use the
// same literal.
export const COMMENTARY_PREFILL = "{";

// One-shot example. Stable across depths intentionally — the per-depth
// guidance later in the prompt drives length and register; this example
// just teaches the JSON shape and the thesis/support voice. Hand-written
// against a fictional 2nm ramp narrative — specific enough that any
// real semi story will diverge on numbers and named players, so the
// model has to transfer the pattern, not the phrasing. Tune in 12d.1
// once we've seen a sample of real Haiku output across sectors.
const ONE_SHOT_EXAMPLE = `Example output for an unrelated story (different sector, different reader — for shape only, do not copy phrasing):
{"thesis":"The TSM 2nm pull-in to Q3 2026 puts your foundry-allocation thesis on a tighter clock than the prior 2027 timeline assumed. If you've been pacing depreciation against the older ramp, the model needs a six-to-nine-month shift.","support":"Capacity bookings disclosed at the April call show >70% of 2nm wafers already committed to four customers — the first time TSMC has confirmed this concentration publicly. Apple, Nvidia, AMD, and Qualcomm absorb the headline allocation; Intel Foundry and Samsung get the mindshare but no near-term volume relief. The second-order effect is on cost-per-transistor curves: a tighter 2nm ramp with the same yield trajectory makes 3nm the long-tail node for two extra quarters, which delays the next price-per-transistor step. If your 2027 P&L assumed a clean migration off 3nm, that's the line to revisit."}`;

export interface CommentaryPromptV2Inputs {
  depth: DepthLevel;
  profile: {
    role: string | null;
    domain: string | null;
    seniority: string | null;
    sectors: string[] | null;
    goals: string[] | null;
  };
  matchedTopics: string[];
  story: {
    sector: string;
    headline: string;
    context: string;
    whyItMatters: string;
  };
}

const SECTOR_LABEL: Record<string, string> = {
  ai: "AI",
  finance: "finance",
  semiconductors: "semiconductors",
};

function humanList(values: string[]): string {
  const items = values.map((v) => v.replace(/_/g, " "));
  if (items.length === 0) return "";
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function audienceBlock(inputs: CommentaryPromptV2Inputs): string {
  const { profile, matchedTopics, story } = inputs;
  const lines: string[] = [];
  if (profile.role) lines.push(`Role: ${profile.role}`);
  if (profile.domain) lines.push(`Field / domain: ${profile.domain.replace(/_/g, " ")}`);
  if (profile.seniority) lines.push(`Seniority: ${profile.seniority.replace(/_/g, " ")}`);
  if (profile.sectors && profile.sectors.length > 0) {
    const labeled = profile.sectors.map((s) => SECTOR_LABEL[s] ?? s);
    lines.push(`Tracks sectors: ${humanList(labeled)}`);
  }
  if (profile.goals && profile.goals.length > 0) {
    lines.push(`Goals on this product: ${humanList(profile.goals)}`);
  }
  if (matchedTopics.length > 0) {
    lines.push(
      `Topics they flagged in ${SECTOR_LABEL[story.sector] ?? story.sector}: ${humanList(matchedTopics)}`,
    );
  }
  return lines.join("\n");
}

export function buildExpandableCommentaryPrompt(
  inputs: CommentaryPromptV2Inputs,
): string {
  const { depth, story } = inputs;
  const sectorLabel = SECTOR_LABEL[story.sector] ?? story.sector;
  const b = DEPTH_BUDGETS[depth];
  const depthLabel = DEPTH_LABEL[depth];

  return [
    `You write commentary for SIGNAL, a professional intelligence platform covering AI, finance, and semiconductors.`,
    "",
    `Output JSON ONLY, matching this schema exactly:`,
    `{ "thesis": string, "support": string }`,
    "",
    ONE_SHOT_EXAMPLE,
    "",
    "Reader profile:",
    audienceBlock(inputs),
    `Audience depth: ${depthLabel}`,
    "",
    `Story sector: ${sectorLabel}`,
    `Headline: ${story.headline}`,
    "",
    `Context (editorial, facts only — do not paraphrase wholesale): ${story.context}`,
    "",
    `Role-neutral editorial baseline (reference, do not copy): ${story.whyItMatters}`,
    "",
    "Write commentary in two parts.",
    "",
    `THESIS (${b.thesisSentences}, ~${b.thesisWords} words — stands alone):`,
    "- State the core insight this story carries for THIS reader.",
    "- Must read as complete commentary if the reader never expands.",
    "- Do not open with \"As a [role]\", \"As you [verb]\", or \"For someone [verb]\".",
    "",
    `SUPPORT (${b.supportSentences}, ~${b.supportWords} words — builds on thesis):`,
    "- Elaborate the mechanism, evidence, or implication.",
    "- Do not restate the thesis.",
    "- Do not open with \"As mentioned\", \"This is because\", or any backward reference to the thesis.",
    "- Open with a fresh clause that advances the analysis.",
    "",
    `Register: ${b.register}.`,
    "",
    "Banned phrases — do not use any of these or close variants:",
    BANNED_PHRASES.map((p) => `- ${p}`).join("\n"),
    "",
    "Return ONLY the JSON object. No preamble, no markdown fences, no commentary on the commentary.",
  ].join("\n");
}
