// Phase 12e.5b — accessible-tier commentary prompt builder.
//
// Pure prompt-construction. No I/O, no DB, no mutable state. The seam
// (`tierGenerationSeam.ts`) loads the candidate row, calls this builder
// for tier='accessible', hands the result to `callHaikuForTier`, parses
// + Zod-validates `{thesis, support}`, and writes the verdict back to
// `ingestion_candidates.tier_outputs` via jsonb_set under the
// 'accessible' key.
//
// Mirrors factExtraction.ts:
//   - same combined-string shape (system instruction + delimited body),
//   - same body cap (re-exported under a tier-accessible-specific
//     alias so future divergence is a one-line change),
//   - same `{` assistant-prefill convention with a stricter retry
//     variant for the parse-retry path.
//
// Voice anchored to commentaryPromptV2.ts accessible register: "plain
// language, no jargon without an inline gloss". Word budgets match
// 12c/12d so 12e.5b output is perceptually consistent with the
// existing per-story commentary at this depth.
//
// 12e.5b deliberately has NO per-user personalization — this is
// event-level commentary written for "an accessible-depth reader in
// [sector]" as an audience archetype, not for a specific reader's
// role/domain/seniority. Per-user shaping happens at display time via
// the reader's depth selection.

export interface TierAccessibleInputs {
  title: string;
  bodyText: string;
  sector: "ai" | "finance" | "semiconductors";
  facts: Array<{ text: string; category: string }>;
}

export const TIER_ACCESSIBLE_BODY_CAP_CHARS = 8000;
export const TIER_ACCESSIBLE_DEFAULT_MAX_TOKENS = 300;
export const TIER_ACCESSIBLE_ASSISTANT_PREFILL = "{";
export const TIER_ACCESSIBLE_ASSISTANT_PREFILL_STRICT = '{"thesis":';

const SYSTEM_INSTRUCTION = [
  'You write commentary for SIGNAL, a professional intelligence platform covering AI, Finance, and Semiconductors.',
  'You receive an article title, a sector tag, a set of pre-extracted facts, and the article body. You return a JSON object with exactly two fields:',
  '  - "thesis": string — the core insight this story carries, written for an accessible-depth reader. 2 sentences, ~35 words. Stands alone if the reader never expands further.',
  '  - "support": string — elaboration of mechanism, evidence, or implication. 3–4 sentences, ~70 words. Builds on the thesis without restating it.',
  '',
  'Audience: a curious professional adjacent to the sector, not deeply embedded in it. Plain language. Define any jargon inline on first use. Use everyday analogies where they aid intuition. Lead with what changed and why someone outside this niche might care.',
  '',
  'Grounding rules:',
  '  - The pre-extracted facts are your primary grounding. Treat them as the authoritative summary of what is in the article.',
  '  - The body is provided for additional context (a quote, a number, a clarifying detail) when the facts alone are too sparse. Do not invent details that appear in neither the facts nor the body.',
  '  - No speculation. If the article does not say something, your commentary does not assert it. Hedged statements ("could", "is expected to") are allowed only when the article attributes the expectation to a named source; carry the attribution forward (e.g., "Goldman expects X", not "X is expected").',
  '',
  'Style rules:',
  '  - Do not open the support with "As mentioned", "This is because", or any backward reference to the thesis. Open with a fresh clause that advances the analysis.',
  '  - Do not write meta-commentary ("This story explains...", "The article reports..."). Write the analysis directly.',
  '  - Do not use trade-press cliches: "game-changer", "in today\'s rapidly evolving landscape", "perfect storm", "uncharted territory", "the writing is on the wall".',
  '',
  'Output ONLY the JSON object. No preamble, no Markdown fencing, no commentary on the commentary. Begin your response with "{".',
].join('\n');

const ONE_SHOT_EXAMPLE = `Example output for an unrelated semiconductors story (different facts — for shape and voice only, do not copy phrasing):
{"thesis":"TSMC's 2nm chip line is starting earlier than expected, and most of its capacity is already spoken for by four big customers. If you've been counting on those chips for a 2027 product cycle, the timeline just tightened.","support":"Chipmaking happens in shared factories, and TSMC is the most advanced one. When more than 70% of next-generation capacity goes to Apple, Nvidia, AMD, and Qualcomm, smaller buyers wait longer or pay more. The pull-in to Q3 2026 means competitors who weren't in those four can't realistically reshuffle. For anyone planning hardware launches that depend on 2nm chips, the booking window has effectively closed."}`;

function truncateBody(bodyText: string): string {
  if (bodyText.length <= TIER_ACCESSIBLE_BODY_CAP_CHARS) return bodyText;
  return bodyText.slice(0, TIER_ACCESSIBLE_BODY_CAP_CHARS) + '\n[...truncated]';
}

function formatFacts(facts: Array<{ text: string; category: string }>): string {
  if (facts.length === 0) return '(no facts available)';
  return facts.map((f) => `- [${f.category}] ${f.text}`).join('\n');
}

export function buildTierAccessiblePrompt(inputs: TierAccessibleInputs): string {
  const title = inputs.title.trim();
  const body = truncateBody(inputs.bodyText.trim());
  const facts = formatFacts(inputs.facts);
  return [
    SYSTEM_INSTRUCTION,
    '',
    ONE_SHOT_EXAMPLE,
    '',
    '---',
    '',
    `Title: ${title}`,
    '',
    `Sector tag: ${inputs.sector}`,
    `(Audience: accessible-depth readers adjacent to this sector. Use the sector tag as framing context for what kinds of analogies and reference points will land.)`,
    '',
    'Facts (extracted from this body in a prior step):',
    facts,
    '',
    'Body:',
    body,
    '',
    '---',
    '',
    'Return JSON only.',
  ].join('\n');
}
