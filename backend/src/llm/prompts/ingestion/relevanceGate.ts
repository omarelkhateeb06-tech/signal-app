// Phase 12e.4 — LLM relevance-gate prompt builder.
//
// Pure prompt-construction. No I/O, no DB, no mutable state. The seam
// (`relevanceSeam.ts`) calls this once per candidate, hands the result
// to `callHaikuForRelevance`, parses + validates the model's JSON, and
// writes the verdict back to `ingestion_candidates`.
//
// Design choices (locked per Stage 1 §G):
//   - G5 sector vocabulary: forced 3-way classification. The prompt
//     names `ai`, `finance`, `semiconductors` as the only acceptable
//     sector values; out-of-scope content sets `relevant: false` and
//     puts the off-topic reason in the `reason` field. No `other`
//     escape hatch — the validation layer treats out-of-vocabulary
//     sector strings as a parse error and triggers the single retry.
//   - G7 location: `backend/src/llm/prompts/ingestion/`. Matches the
//     directory the roadmap names for the 12e.5b tier prompts.
//   - G8 input scope: `raw_title + body_text`. No `raw_summary`. The
//     body extraction (12e.3) is the canonical content; summary is
//     redundant. Body is truncated to 8000 chars with a marker if
//     longer, so token count stays bounded regardless of source.
//
// Iteration: prompt wording is intentionally direct and minimal here.
// The "first 100 calls" audit gate (per roadmap §12e.4) is the
// sanctioned moment to refine wording; that work belongs to the 12e.8
// soak session, not 12e.4 stage 2.

export interface RelevanceGateInputs {
  title: string;
  bodyText: string;
}

// Hard cap on body chars passed to the model. Chosen to keep input
// tokens predictable (~2500 tokens at ~3.2 chars/token Haiku-side).
// Articles longer than this get truncated with a marker; the relevance
// verdict generally hinges on the lede + first few sections, so
// truncation is unlikely to flip a correct judgment.
export const RELEVANCE_GATE_BODY_CAP_CHARS = 8000;

// Assistant-side prefill — biases Haiku toward emitting a JSON object.
// Re-attached to the response by `callHaikuForCommentary` so downstream
// JSON.parse sees the full payload.
export const RELEVANCE_GATE_ASSISTANT_PREFILL = "{";

// Stricter prefill used on the parse-retry path — biases the model
// even harder by including the first key-quote, leaving only the value
// + closing brace to fill in.
export const RELEVANCE_GATE_ASSISTANT_PREFILL_STRICT = '{"relevant":';

const SYSTEM_INSTRUCTION = [
  'You are a relevance gate for a professional intelligence feed covering AI, Finance, and Semiconductors.',
  'You receive an article title and body. You return a JSON object with three fields:',
  '  - "relevant": boolean — true if the article is substantively about AI, Finance, or Semiconductors and would be useful to a professional in one of those fields. False otherwise.',
  '  - "sector": string — exactly one of "ai", "finance", "semiconductors". Required when relevant=true. May be omitted when relevant=false.',
  '  - "reason": string — one or two sentences explaining the verdict. For relevant=true, what makes it useful. For relevant=false, what the article is actually about.',
  '',
  'Sector vocabulary is closed. If the article does not fit any of "ai", "finance", "semiconductors" (e.g., sports, lifestyle, entertainment, generic tech without finance/semis tie-in), set relevant=false and explain in reason. Do not invent new sector values.',
  '',
  'Output ONLY the JSON object. No preamble, no Markdown fencing, no commentary. Begin your response with "{".',
].join('\n');

function truncateBody(bodyText: string): string {
  if (bodyText.length <= RELEVANCE_GATE_BODY_CAP_CHARS) return bodyText;
  return bodyText.slice(0, RELEVANCE_GATE_BODY_CAP_CHARS) + '\n[...truncated]';
}

export function buildRelevanceGatePrompt(inputs: RelevanceGateInputs): string {
  const title = inputs.title.trim();
  const body = truncateBody(inputs.bodyText.trim());
  return [
    SYSTEM_INSTRUCTION,
    '',
    '---',
    '',
    `Title: ${title}`,
    '',
    'Body:',
    body,
    '',
    '---',
    '',
    'Return JSON only.',
  ].join('\n');
}
