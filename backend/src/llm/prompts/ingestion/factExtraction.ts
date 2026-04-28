// Phase 12e.5a — fact-extraction prompt builder.
//
// Pure prompt-construction. No I/O, no DB, no mutable state. The seam
// (`factsSeam.ts`) calls this once per `llm_relevant` candidate, hands
// the result to `callHaikuForFacts`, parses + Zod-validates the model's
// JSON, and writes the verdict back to `ingestion_candidates`
// (facts column + facts_extracted_at + facts_extraction_raw audit blob).
//
// Mirrors relevanceGate.ts:
//   - same combined-string shape (system instruction + delimited body),
//   - same body cap (re-exported under a facts-specific alias so future
//     divergence is a one-line change),
//   - same `{` assistant-prefill convention with a stricter retry
//     variant for the parse-retry path.
//
// Locked-decision footprint (see phase-12e5a-audit.md):
//   - 5–8 facts per article. Hard count enforced in Zod; soft-stated in
//     the system instruction.
//   - Open category vocabulary. The system instruction names a
//     suggested set (actor, action, metric, timeframe, market_reaction,
//     technical_detail, context) but the model may use other categories
//     when more accurate. Zod accepts free-text.
//   - Sector hint goes in the user message as soft context, not in the
//     system instruction. Framing per the locked decision: "tagged as
//     X; use as context but extract facts that appear in the body".
//   - Zero-shot. No few-shot examples. Shape drift is handled by Zod
//     + parse-retry with a stricter prefill.
//
// Iteration: prompt wording is intentionally direct and minimal here.
// The roadmap's "first 100 calls" audit gate is the sanctioned moment
// to refine wording (12e.8 soak), not stage 2 of 12e.5a.

export interface FactExtractionInputs {
  title: string;
  bodyText: string;
  // The 12e.4-validated sector classification. Passed as soft context
  // in the user message — see SYSTEM_INSTRUCTION's sector framing.
  sector: "ai" | "finance" | "semiconductors";
}

// Hard cap on body chars passed to the model. Reuses the relevance-gate
// cap (8000 chars ≈ 2500 input tokens at Haiku tokenization). Re-export
// under a facts-specific alias so a future divergence (e.g. 12e.8 soak
// shows facts hide past char 8000 and we lift the cap for 12e.5a only)
// is a one-line change.
//
// Intentionally NOT imported from relevanceGate — keeping the constant
// local prevents a tier-prompt bump in 12e.5b from flapping this stage
// by accident.
export const FACTS_PROMPT_BODY_CAP_CHARS = 8000;

// Per-call max_tokens budget. 5–8 facts × ~30–60 output tokens each +
// JSON envelope ≈ 300–500 tokens; 800 is comfortable headroom. The
// failure mode of a too-tight budget is mid-JSON truncation (parse
// error → retry → terminal facts_parse_error), strictly worse than the
// extra ~$0.0015 of headroom per call at Haiku pricing.
export const FACTS_DEFAULT_MAX_TOKENS = 800;

// Assistant-side prefill — biases Haiku toward emitting a JSON object.
// `callHaikuForCommentary` re-attaches the prefill to the response so
// downstream JSON.parse sees the full payload.
export const FACTS_PROMPT_ASSISTANT_PREFILL = "{";

// Stricter prefill used on the parse-retry path — biases the model by
// including the top-level key-quote, leaving only the array contents +
// closing brace to fill in. Mirrors RELEVANCE_GATE_ASSISTANT_PREFILL_STRICT.
export const FACTS_PROMPT_ASSISTANT_PREFILL_STRICT = '{"facts":';

const SYSTEM_INSTRUCTION = [
  'You are a fact extractor for a professional intelligence feed covering AI, Finance, and Semiconductors.',
  'You receive an article title, a sector tag, and the article body. You return a JSON object with one field:',
  '  - "facts": an array of 5 to 8 fact objects extracted from the body.',
  '',
  'Each fact object has exactly two fields:',
  '  - "text": string — the fact, stated as a single declarative sentence drawn from the body. Concrete and specific. No opinions, no speculation, no hedging language. Hedged statements ("could", "might", "is expected to") are allowed only when the article attributes the expectation to a named source; in that case, carry the attribution into the fact text (e.g., "Goldman expects rates to drop 50bps in Q3," not "rates are expected to drop 50bps in Q3").',
  '  - "category": string — a short label for the primary aspect of the fact. A fact may have multiple aspects (an actor, an action, a number, a timeframe); pick the most salient one. Suggested categories: "actor" (who is involved), "action" (what they did), "metric" (a number, percentage, or quantity), "timeframe" (when), "market_reaction" (price/share-movement response), "technical_detail" (architecture, methodology, mechanism), "context" (background that frames the news). You may use a different category label when one of the suggested ones does not fit; keep it short, lowercase, and snake_case.',
  '',
  'Rules for extraction:',
  '  - Extract 5 to 8 facts. Not fewer, not more. If the article is thin, prefer the most load-bearing facts. If the article is dense, pick the 8 that best support understanding the news.',
  '  - Every fact must appear in the body. Do not invent facts. Do not infer numbers, dates, or names that are not stated.',
  '  - Do not extract the article author\'s editorial commentary as a fact. (Quote attribution rules are covered above.)',
  '  - Do not duplicate facts. If two sentences in the body state the same metric two ways, extract it once.',
  '',
  'Output ONLY the JSON object. No preamble, no Markdown fencing, no commentary. Begin your response with "{".',
].join('\n');

function truncateBody(bodyText: string): string {
  if (bodyText.length <= FACTS_PROMPT_BODY_CAP_CHARS) return bodyText;
  return bodyText.slice(0, FACTS_PROMPT_BODY_CAP_CHARS) + '\n[...truncated]';
}

export function buildFactExtractionPrompt(inputs: FactExtractionInputs): string {
  const title = inputs.title.trim();
  const body = truncateBody(inputs.bodyText.trim());
  return [
    SYSTEM_INSTRUCTION,
    '',
    '---',
    '',
    `Title: ${title}`,
    '',
    `Sector tag: ${inputs.sector}`,
    `(This is the upstream classification. Use it as context for what kinds of facts a reader of this sector would care about. Do not invent sector-relevant facts that are not in the body.)`,
    '',
    'Body:',
    body,
    '',
    '---',
    '',
    'Return JSON only.',
  ].join('\n');
}
