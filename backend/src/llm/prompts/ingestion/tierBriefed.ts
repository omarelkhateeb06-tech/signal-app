// Phase 12e.5b — briefed-tier commentary prompt builder.
//
// Mirrors tierAccessible.ts in shape; diverges in audience framing,
// register, and word budget. Per-file copies of constants are
// intentional — the 12e.5a "future divergence is a one-line change"
// pattern carries forward.
//
// Voice anchored to commentaryPromptV2.ts briefed register:
// "domain-fluent, minimal hand-holding". Word budgets match 12c/12d
// briefed: thesis ~40 words / 2 sentences, support ~90 words /
// 3–5 sentences.
//
// Audience framing was sharpened in stage 1.5 redline after a
// calibration test where the model output an unglossed niche benchmark
// name (AIME 2025) for a briefed reader. The framing now explicitly
// distinguishes sector-general vocabulary (kept) from specialist
// research jargon (glossed inline).

export interface TierBriefedInputs {
  title: string;
  bodyText: string;
  sector: "ai" | "finance" | "semiconductors";
  facts: Array<{ text: string; category: string }>;
}

export const TIER_BRIEFED_BODY_CAP_CHARS = 8000;
export const TIER_BRIEFED_DEFAULT_MAX_TOKENS = 400;
export const TIER_BRIEFED_ASSISTANT_PREFILL = "{";
export const TIER_BRIEFED_ASSISTANT_PREFILL_STRICT = '{"thesis":';

const SYSTEM_INSTRUCTION = [
  'You write commentary for SIGNAL, a professional intelligence platform covering AI, Finance, and Semiconductors.',
  'You receive an article title, a sector tag, a set of pre-extracted facts, and the article body. You return a JSON object with exactly two fields:',
  '  - "thesis": string — the core insight this story carries, written for a briefed-depth reader. 2 sentences, ~40 words. Stands alone if the reader never expands further.',
  '  - "support": string — elaboration of mechanism, evidence, or implication. 3–5 sentences, ~90 words. Builds on the thesis without restating it.',
  '',
  'Audience: a sector professional who is fluent in the broad sector but not specialized in this exact subdomain. They know the major players, the dominant business models, the recurring themes, and common acronyms (API, GPU, LLM, EPS, P/E, fab, node). They do **not** know specialist benchmark names, internal research jargon, niche acronyms, or the names of every paper or technique. When a term is specialist rather than sector-general, gloss it inline in 3–6 words, or refer to it descriptively (e.g., "a math reasoning benchmark" rather than "AIME 2025"). Skip explanations of sector-general concepts. Lead with the implication for someone working adjacent to this story.',
  '',
  'Grounding rules:',
  '  - The pre-extracted facts are your primary grounding. Treat them as the authoritative summary of what is in the article.',
  '  - The body is provided for additional context (a quote, a number, a clarifying detail) when the facts alone are too sparse. Do not invent details that appear in neither the facts nor the body.',
  '  - No speculation. If the article does not say something, your commentary does not assert it. Hedged statements ("could", "is expected to") are allowed only when the article attributes the expectation to a named source; carry the attribution forward.',
  '',
  'Style rules:',
  '  - Do not open the support with "As mentioned", "This is because", or any backward reference to the thesis. Open with a fresh clause that advances the analysis.',
  '  - Do not write meta-commentary ("This story explains...", "The article reports..."). Write the analysis directly.',
  '  - Do not use trade-press cliches: "game-changer", "in today\'s rapidly evolving landscape", "perfect storm", "uncharted territory", "the writing is on the wall".',
  '',
  'Output ONLY the JSON object. No preamble, no Markdown fencing, no commentary on the commentary. Begin your response with "{".',
].join('\n');

const ONE_SHOT_EXAMPLE = `Example output for an unrelated semiconductors story (different facts — for shape and voice only, do not copy phrasing):
{"thesis":"TSMC's 2nm pull-in to Q3 2026 with >70% capacity already booked tightens the foundry-allocation window for anyone outside the four-customer block. If your roadmap assumed a 2027 ramp, six-to-nine months has just come off the front end.","support":"The four named customers — Apple, Nvidia, AMD, Qualcomm — absorb the headline allocation, leaving Intel Foundry and Samsung Foundry carrying mindshare without near-term volume relief. Second-order effect: 3nm becomes the long-tail node for two extra quarters, delaying the next price-per-transistor step. For procurement teams pacing depreciation against the older timeline, the model needs a shift forward. The publicly confirmed concentration also recalibrates analyst assumptions that had a more diffuse customer mix priced in."}`;

function truncateBody(bodyText: string): string {
  if (bodyText.length <= TIER_BRIEFED_BODY_CAP_CHARS) return bodyText;
  return bodyText.slice(0, TIER_BRIEFED_BODY_CAP_CHARS) + '\n[...truncated]';
}

function formatFacts(facts: Array<{ text: string; category: string }>): string {
  if (facts.length === 0) return '(no facts available)';
  return facts.map((f) => `- [${f.category}] ${f.text}`).join('\n');
}

export function buildTierBriefedPrompt(inputs: TierBriefedInputs): string {
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
    `(Audience: briefed-depth readers — sector-fluent professionals not specialized in this exact subdomain. Use the sector tag as framing context for vocabulary expectations.)`,
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
