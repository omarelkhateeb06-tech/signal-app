// LLM spend instrumentation. Every model call that returns token usage
// emits one structured, greppable log line (tag: `[llm-cost]`) so per-day
// Anthropic / OpenAI spend is reconstructable from the Railway logs — the
// ground-truth unit economics the roadmap (§19) calls for, instead of
// estimates. Aggregate with: `grep '[llm-cost]' | jq` over a log export.
//
// Two design rules:
//   - `computeCostUsd` is pure and deterministic — same inputs, same output.
//   - `logLlmUsage` NEVER throws. Instrumentation must not be able to break
//     a model call; any failure inside it is swallowed.
//
// Pricing is keyed by the EXACT model string each client passes. A model-pin
// change that isn't added here surfaces as a `priced:false`, `costUsd:0` line
// (still logged, token counts intact) rather than a silently-wrong number —
// the gap is visible in the logs.

export interface ModelPricing {
  /** USD per 1,000,000 input tokens. */
  inputPerMTok: number;
  /** USD per 1,000,000 output tokens. */
  outputPerMTok: number;
}

// Verified June 2026 pricing (ROADMAP §19.2). Embeddings are input-only.
export const LLM_PRICING: Record<string, ModelPricing> = {
  "claude-haiku-4-5-20251001": { inputPerMTok: 1, outputPerMTok: 5 },
  "claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5 },
  "text-embedding-3-small": { inputPerMTok: 0.02, outputPerMTok: 0 },
};

// Stable prefix so a log drain / grep can isolate spend lines.
export const LLM_COST_LOG_TAG = "[llm-cost]";

export interface LlmUsageInput {
  provider: "anthropic" | "openai";
  // Where the call originated — e.g. "commentary", "relevance", "facts",
  // "tier:accessible", "through_line", "embedding", "depth_variant". Lets a
  // log aggregation attribute spend per pipeline stage, not just per model.
  callSite: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface LlmUsageRecord extends LlmUsageInput {
  costUsd: number;
  // False when the model has no entry in LLM_PRICING (costUsd is then 0 but
  // the token counts are still recorded — a flag to add the missing price).
  priced: boolean;
}

// Negative token counts are clamped to 0 — a malformed usage object should
// never produce a negative cost.
export function computeCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = LLM_PRICING[model];
  if (!pricing) return 0;
  const input = (Math.max(0, inputTokens) / 1_000_000) * pricing.inputPerMTok;
  const output = (Math.max(0, outputTokens) / 1_000_000) * pricing.outputPerMTok;
  return input + output;
}

export function buildUsageRecord(input: LlmUsageInput): LlmUsageRecord {
  const costUsd = computeCostUsd(
    input.model,
    input.inputTokens,
    input.outputTokens,
  );
  return {
    ...input,
    // 8 dp keeps fractions-of-a-cent calls honest without float noise.
    costUsd: Math.round(costUsd * 1e8) / 1e8,
    priced: input.model in LLM_PRICING,
  };
}

/**
 * Emit one structured spend line. Suppressed when `LLM_COST_LOG=0` (test
 * noise reduction). Never throws.
 */
export function logLlmUsage(input: LlmUsageInput): void {
  if (process.env.LLM_COST_LOG === "0") return;
  try {
    const record = buildUsageRecord(input);
    // eslint-disable-next-line no-console
    console.log(`${LLM_COST_LOG_TAG} ${JSON.stringify(record)}`);
  } catch {
    // Instrumentation must never break the call it is measuring.
  }
}
