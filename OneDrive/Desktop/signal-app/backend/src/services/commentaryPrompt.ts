// Phase 12c — Haiku prompt construction for per-user, per-story
// commentary.
//
// Single source of truth for the prompt shape. Kept pure so unit tests
// can assert verbatim substrings without spinning up a mock Anthropic
// client. The prompt layers (in this order):
//
//   1. Role framing — who the model is writing for (the product copy
//      asks for commentary, not a recap).
//   2. Audience profile — role / domain / seniority / sectors / goals
//      / matched-topic callouts.
//   3. Story block — headline + editorial context + the role-neutral
//      why_it_matters baseline (so the model has the facts without us
//      guessing them from the headline alone).
//   4. Depth guidance — same tone ladder as depthVariantGenerator, so
//      the three depths remain directly comparable.
//   5. Output contract — banned-phrase list + "no preamble" reminder.
//
// The banned-phrase list is hardcoded into the prompt so the model
// self-filters; the post-generation `checkBannedPhrases` pass
// (commentaryFallback.ts) is a defense-in-depth trip-wire, not the
// primary enforcement.

import { BANNED_PHRASES } from "./commentaryFallback";
import type { DepthLevel } from "../db/schema";

// Matches depthVariantGenerator's guidance so the two prompt paths stay
// comparable. Word counts intentionally match.
const DEPTH_GUIDANCE: Record<DepthLevel, string> = {
  accessible:
    "Plain language, no domain jargon. A smart non-specialist reader. " +
    "Prioritize the one thing the reader should walk away knowing. ~80–120 words.",
  standard:
    "Working-professional framing; light domain terminology allowed. " +
    "Implications and second-order effects over narrative recap. ~120–160 words.",
  technical:
    "Domain insider. Precise terminology; cite specific numbers, " +
    "mechanisms, or people when they change the interpretation. Skip " +
    "introductory framing. ~160–220 words.",
};

export interface CommentaryPromptInputs {
  depth: DepthLevel;
  // Profile pieces. `role`, `domain`, and `seniority` are required by
  // Tier 1/2 fallback but may be null when landing here — the prompt
  // still reads coherently, just with blanker framing.
  profile: {
    role: string | null;
    domain: string | null;
    seniority: string | null;
    sectors: string[] | null;
    goals: string[] | null;
  };
  matchedTopics: string[]; // Topics declared against this story's sector.
  story: {
    sector: string;
    headline: string;
    context: string;
    whyItMatters: string;
  };
}

// Human-readable fragment helpers. Match commentaryFallback's output
// where possible so the tiered paths don't feel jarringly different.
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

function audienceBlock(inputs: CommentaryPromptInputs): string {
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
  // Topics block — only include the ones matched for THIS story's
  // sector (cross-sector picks are noise for this story). Omit the
  // line entirely if nothing matched so the model doesn't try to
  // invent a connection.
  if (matchedTopics.length > 0) {
    lines.push(
      `Topics they flagged in ${SECTOR_LABEL[story.sector] ?? story.sector}: ${humanList(matchedTopics)}`,
    );
  }
  return lines.join("\n");
}

export function buildCommentaryPrompt(inputs: CommentaryPromptInputs): string {
  const { depth, story } = inputs;
  const sectorLabel = SECTOR_LABEL[story.sector] ?? story.sector;

  return [
    `You are writing a short, personalized "why this matters" paragraph for a single reader of SIGNAL — a ranked-feed intelligence product covering ${sectorLabel}, finance, and semiconductors. The reader has already chosen to read this story; commentary must explain why it matters to THEM specifically, not recap what it is.`,
    "",
    "Reader profile:",
    audienceBlock(inputs),
    "",
    `Story sector: ${sectorLabel}`,
    `Headline: ${story.headline}`,
    "",
    `Context (editorial, facts only — do not paraphrase wholesale): ${story.context}`,
    "",
    `Role-neutral editorial baseline on why it matters (reference, do not copy): ${story.whyItMatters}`,
    "",
    `Audience depth: ${depth}. ${DEPTH_GUIDANCE[depth]}`,
    "",
    "Banned phrases — do not use any of these or close variants. They mark the commentary as low-effort trade-press copy and defeat the whole point of personalization:",
    BANNED_PHRASES.map((p) => `- ${p}`).join("\n"),
    "",
    "Output ONLY the commentary paragraph. No preamble, no headers, no bullet lists, no quotes around the output. Address the reader in second person where natural.",
  ].join("\n");
}
