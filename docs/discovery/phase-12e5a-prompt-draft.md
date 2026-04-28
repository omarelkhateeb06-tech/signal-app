# Phase 12e.5a — Prompt + Zod-schema draft for planner review

**Date:** 2026-04-27
**Status:** review artifact — nothing in this doc is committed to the canonical source tree.
**Scope:** the fact-extraction prompt module and the `ExtractedFacts` Zod schema, plus the stricter parse-retry prefill. Stage 2 implements after planner redline.

The drafts below mirror `backend/src/llm/prompts/ingestion/relevanceGate.ts` (prompt) and the inline `RelevanceJudgmentSchema` in `backend/src/jobs/ingestion/relevanceSeam.ts` (schema), with edits per the locked decisions in `phase-12e5a-audit.md`'s closure.

## §1. Proposed prompt module

Proposed source for `backend/src/llm/prompts/ingestion/factExtraction.ts`. Follows `relevanceGate.ts`'s shape exactly:

- single combined-string prompt (system + user concatenated; matches `buildRelevanceGatePrompt`'s return-`string` contract — the underlying `callHaikuForCommentary` does not separate system vs user, so a unified string is the in-repo convention);
- exported tunable constants;
- exported prefill constants (default + stricter retry);
- exported inputs interface;
- pure of I/O.

```ts
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
    '(This is the upstream classification. Use it as context for what kinds of facts a reader of this sector would care about. Do not invent sector-relevant facts that are not in the body.)`,
    '',
    'Body:',
    body,
    '',
    '---',
    '',
    'Return JSON only.',
  ].join('\n');
}
```

### Notes on choices

- **Single-string return, not `{ system, user, assistantPrefill }`.** Brief offered the option to match `relevanceGate.ts`'s shape; it returns a single concatenated string, so this does too. Keeps the seam parity tight and avoids a parallel-but-different prompt-shape convention living in the same directory.
- **Sector hint placement.** Per the locked decision the sector hint is "soft context, not constraint". Putting it in the user message (after title, before body) frames it as part of the per-call payload, not a global rule — matches the framing the locked decision asked for. The accompanying parenthetical reinforces "use as context, do not invent".
- **System instruction explicitly bans opinion/speculation.** Not in the locked decisions but a natural follow-on from "facts only". Surfaced as a draft choice; flag in §4.
- **Suggested-categories list lives in the system instruction.** Per the locked decision the vocabulary is open at the Zod boundary; the system instruction is the soft-constraint layer. The trailing line ("you may use a different category … keep it short, lowercase, snake_case") is the explicit extension point.

## §2. Proposed Zod schema

Proposed schema for the seam to import. Lives in `factsSeam.ts` (or a colocated `factsSchema.ts` if the seam grows), not in the prompt module — same separation as `relevanceSeam.ts`'s `RelevanceJudgmentSchema`.

```ts
import { z } from "zod";

// 12e.5a — fact-extraction output schema.
//
// Open category vocabulary: per the locked decision, `category` is
// free-text, not a closed enum. The prompt's suggested vocabulary is a
// soft constraint enforced by the LLM; Zod treats any non-empty string
// as valid. This keeps schema churn out of the loop when the soak
// surfaces a useful new category.
//
// Length bounds on `text`: floor 10 chars to filter trivial fragments
// (e.g., "Q1 2026."); ceiling 500 chars (~80–100 words) to bound output
// token usage and to flag malformed extractions where the model dumps a
// paragraph as a "fact". The 500 ceiling is well above the typical
// 1-sentence target (~150–250 chars) but below the runaway-paragraph
// failure mode.
//
// Length bound on `category`: floor 1 char (any non-empty string).
// Ceiling 64 chars — generous for snake_case labels; tight enough that
// a model dumping prose into the field fails validation cleanly.
//
// Array length: hard 5–8 per the locked decision. Below 5 → too thin;
// above 8 → too noisy. Matches the prompt's stated count.
//
// `.strict()` on the per-fact object rejects extra fields. The model
// occasionally adds a `confidence` or `source_span` field when given
// freedom; we want those to fail validation rather than silently land
// in the persisted blob.
export const ExtractedFactSchema = z.object({
  text: z.string().min(10).max(500),
  category: z.string().min(1).max(64),
}).strict();

export const ExtractedFactsSchema = z.object({
  facts: z.array(ExtractedFactSchema).min(5).max(8),
}).strict();

export type ExtractedFact = z.infer<typeof ExtractedFactSchema>;
export type ExtractedFacts = z.infer<typeof ExtractedFactsSchema>;
```

### Decisions surfaced

- **Top-level `{ facts: [...] }` object, not bare array.** Two reasons:
  1. The default JSON-prefill is `{`. A bare-array response would need prefill `[` and a different stricter-retry prefill convention; both are minor but they fork the prefill discipline that 12e.4 established.
  2. An object gives free room to add metadata (e.g. `extraction_notes`, `confidence_overall`) later without a breaking schema change. Today none of those exist; tomorrow's iteration is cheap.
- **Per-fact shape `{ text, category }`. No `confidence` field.** Per the locked decision "no per-fact source span" and "no extras unless justified". A free-form `confidence` from the LLM is unreliable signal (the model returns numbers but they are not calibrated probabilities) and adds tokens without a downstream consumer. 12e.5b's tier prompts will weight categories themselves; they don't need a per-fact confidence.
- **`text` bounds at `[10, 500]` chars.** Floor is light filtering; ceiling is a runaway-paragraph guard. Stage 2 may want to bump the ceiling once we see real output; flagged as a soft tunable in §4.
- **`category` bounds at `[1, 64]` chars.** Floor accepts any non-empty label; ceiling rejects "I think this fact is a kind of …" prose-in-the-category-field failures.
- **`.strict()` on both objects.** Extra fields fail. Mirrors the lock-down shape of 12a's `WhyItMattersTemplateSchema` (`backend/src/utils/depthVariants.ts`) — same .strict() discipline at the Zod boundary, same lenient-on-read fallback discipline at the consumer (12e.5b will have its own parser).
- **No `id` or `order` field on `ExtractedFact`.** Position-in-array is the implicit ordering; a separate `id` is unnecessary because facts are persisted as a unit (`ingestion_candidates.facts` is one JSONB blob). If a downstream surface needs stable IDs, generate them at read time.

## §3. Stricter retry prefill

12e.4's parse-retry path uses a stricter assistant prefill on attempt 2 (`'{"relevant":'`) — see `relevanceSeam.ts:269–275` and the constant `RELEVANCE_GATE_ASSISTANT_PREFILL_STRICT` in `relevanceGate.ts:47`. The rationale (file header note): "biases the model even harder by including the first key-quote, leaving only the value + closing brace to fill in."

For 12e.5a the equivalent is exported in §1 as:

```ts
export const FACTS_PROMPT_ASSISTANT_PREFILL_STRICT = '{"facts":';
```

This commits the model to opening with `{"facts":` and leaves it only the array literal `[...]` plus a closing `}` to emit. Empirically (from 12e.4) the stricter prefill flips the parse-success rate on the retry path from ~0% (first-attempt failures are usually persistent without intervention) to high enough that `LLM_PARSE_ERROR` is the rare terminal — both 12e.4 smoke calls succeeded on attempt 1; the retry path is unit-tested but un-exercised live.

### Hookup for the stage-2 seam

The stage-2 `factsSeam.ts` mirrors `relevanceSeam.ts`'s `runRelevanceSeam` flow:

1. Attempt 1: `callHaikuForFacts(prompt, { assistantPrefill: FACTS_PROMPT_ASSISTANT_PREFILL })`.
2. On `tryParseFacts(text) === null` → attempt 2: same prompt, `{ assistantPrefill: FACTS_PROMPT_ASSISTANT_PREFILL_STRICT }`.
3. On attempt-2 failure: terminal `FACTS_REASONS.FACTS_PARSE_ERROR`, persist the most recent `responseText` in the audit blob.

The `tryParseFacts` helper is the analogue of `tryParseJudgment` in `relevanceSeam.ts:146–162`. It does `JSON.parse` then `ExtractedFactsSchema.safeParse`; returns the parsed value on success, `null` on either failure. No retry-trigger conditions beyond "parse failed" — unlike 12e.4's sector-vocabulary retry, the facts schema doesn't have an "out-of-vocabulary value forces a retry" path, because category is open and length-only.

### `FACTS_REASONS` taxonomy (for the seam, sketched here for completeness)

```ts
export const FACTS_REASONS = {
  FACTS_PARSE_ERROR: "facts_parse_error",
  FACTS_RATE_LIMITED: "facts_rate_limited",
  FACTS_TIMEOUT: "facts_timeout",
  FACTS_NO_API_KEY: "facts_no_api_key",
  FACTS_EMPTY: "facts_empty",
  FACTS_API_ERROR: "facts_api_error",
} as const;
```

Mirrors 12e.4's `RELEVANCE_REASONS` byte-for-byte except for the `_REJECTED` slot — facts have no LLM-side rejection path (the model can't say "I refuse to extract facts from this article" the way it can say "this isn't relevant"). All facts-stage failures are transport- or parse-class.

## §4. Open questions for planner

**All questions closed by planner. Stage 2 ready.**

- **Q1 — opinion/speculation ban + hedging carve-out wording.** Closed via three redlines applied to §1 above:
  1. Hedging rule restructured into a clean two-sentence form with a worked example ("Goldman expects rates to drop 50bps in Q3," not "rates are expected to drop 50bps in Q3"). The example is load-bearing — it forces the LLM to carry attribution into the fact text rather than stripping it.
  2. `category` field reframed as "primary aspect" with explicit acknowledgment that a fact may have multiple aspects, to reduce inconsistent picks across calls.
  3. Redundant author-editorializing clause in rules-for-extraction collapsed to a one-liner that points back to the `text`-field rules. Two carve-outs in slightly different wording invite the LLM to treat them as distinct constraints; one source of truth is cleaner.
- **Q2 — `text` ceiling at 500 chars.** Closed: keep.
- **Q3 — `category` ceiling at 64 chars.** Closed: keep.
- **Q4 — `.strict()` posture on `ExtractedFactSchema`.** Closed: keep.
- **Q5 — sector hint as closed typed-union.** Closed: keep.
- **Q6, Q7 — surfaced for awareness only, no question pending.** No action.

### Awareness flags from planner review (not blocking)

- **Padding risk on truly thin articles.** The hard 5–8 floor + Zod validation may force the LLM to invent or stretch facts on thin articles that slip past heuristic + relevance. Watch in 12e.8 soak; if hallucinated/padded facts appear, options are loosen the floor or tighten upstream filters. Not an action item for stage 2.
- **`actor` / `action` overlap.** Most action facts have an actor as subject; the two suggested categories still overlap even with the "primary aspect" framing. The open-vocabulary safety valve (model can emit categories outside the suggested seven) plus 12e.8 soak feedback is sufficient mitigation pre-launch. No restructure now.

**Stage 2 ready.**
