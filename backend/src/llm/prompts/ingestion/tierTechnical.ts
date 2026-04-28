// Phase 12e.5b — technical-tier commentary prompt builder.
//
// Mirrors tierAccessible.ts and tierBriefed.ts in shape; diverges in
// audience framing, register, and word budget. Per-file copies of
// constants are intentional.
//
// Voice anchored to commentaryPromptV2.ts technical register:
// "assumes expert familiarity; precise terminology, named mechanisms,
// specific numbers". Word budgets match 12c/12d technical: thesis
// ~40 words / 1–2 sentences, support ~130 words / 4–6 sentences.

export interface TierTechnicalInputs {
  title: string;
  bodyText: string;
  sector: "ai" | "finance" | "semiconductors";
  facts: Array<{ text: string; category: string }>;
}

export const TIER_TECHNICAL_BODY_CAP_CHARS = 8000;
export const TIER_TECHNICAL_DEFAULT_MAX_TOKENS = 500;
export const TIER_TECHNICAL_ASSISTANT_PREFILL = "{";
export const TIER_TECHNICAL_ASSISTANT_PREFILL_STRICT = '{"thesis":';

const SYSTEM_INSTRUCTION = [
  'You write commentary for SIGNAL, a professional intelligence platform covering AI, Finance, and Semiconductors.',
  'You receive an article title, a sector tag, a set of pre-extracted facts, and the article body. You return a JSON object with exactly two fields:',
  '  - "thesis": string — the core insight this story carries, written for a technical-depth reader. 1–2 sentences, ~40 words. Stands alone if the reader never expands further.',
  '  - "support": string — elaboration of mechanism, evidence, or implication. 4–6 sentences, ~130 words. Builds on the thesis without restating it.',
  '',
  'Audience: an expert in this exact subdomain. Assume expert familiarity. Use precise technical vocabulary, named mechanisms, specific numbers, and acronyms in their bare form (no glosses). Lead with the technical detail or quantitative result that experts would want to see first.',
  '',
  'Grounding rules:',
  '  - The pre-extracted facts are your primary grounding. Treat them as the authoritative summary of what is in the article.',
  '  - The body is provided for additional context (a quote, a number, a clarifying detail) when the facts alone are too sparse. Do not invent details that appear in neither the facts nor the body.',
  '  - No speculation. If the article does not say something, your commentary does not assert it. Hedged statements ("could", "is expected to") are allowed only when the article attributes the expectation to a named source; carry the attribution forward.',
  '  - Specific numbers, model names, architecture names, ticker symbols, and dates must come from the facts or body. Do not interpolate plausible-sounding figures.',
  '',
  'Style rules:',
  '  - Do not open the support with "As mentioned", "This is because", or any backward reference to the thesis. Open with a fresh clause that advances the analysis.',
  '  - Do not write meta-commentary ("This story explains...", "The article reports..."). Write the analysis directly.',
  '  - Do not use trade-press cliches: "game-changer", "in today\'s rapidly evolving landscape", "perfect storm", "uncharted territory", "the writing is on the wall".',
  '',
  'Output ONLY the JSON object. No preamble, no Markdown fencing, no commentary on the commentary. Begin your response with "{".',
].join('\n');

const ONE_SHOT_EXAMPLE = `Example output for an unrelated semiconductors story (different facts — for shape and voice only, do not copy phrasing):
{"thesis":"TSMC's N2 pull-in to Q3 2026 lands with >70% of N2 wafer capacity committed to AAPL/NVDA/AMD/QCOM, confirming the four-customer concentration prior call commentary had hedged. The implication for IFS and Samsung SF2 is no near-term displacement vector.","support":"Density at N2 over N3E tracks ~1.15x at iso-Vt, with HVM yield curves following the N3 ramp at the equivalent post-tape-out quarter. The pull-in does not materially shift the per-wafer cost-per-transistor curve — that step still sits at N2P in 2028 — but it does compress the migration window for designs targeting N3E as a long-tail node by roughly two quarters. For customers outside the four-allocation block, the realistic options narrow to Samsung SF2 (yield gap unconfirmed publicly) or staying on N3E through 2027. The publicly confirmed concentration also recalibrates analyst models that had assumed a more diffuse customer mix, with consensus 2026–27 EPS estimates likely 3–5% conservative on the announced allocation."}`;

function truncateBody(bodyText: string): string {
  if (bodyText.length <= TIER_TECHNICAL_BODY_CAP_CHARS) return bodyText;
  return bodyText.slice(0, TIER_TECHNICAL_BODY_CAP_CHARS) + '\n[...truncated]';
}

function formatFacts(facts: Array<{ text: string; category: string }>): string {
  if (facts.length === 0) return '(no facts available)';
  return facts.map((f) => `- [${f.category}] ${f.text}`).join('\n');
}

export function buildTierTechnicalPrompt(inputs: TierTechnicalInputs): string {
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
    `(Audience: technical-depth readers — domain experts in this sector. Use the sector tag as framing for which subdomain vocabulary is expected.)`,
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
