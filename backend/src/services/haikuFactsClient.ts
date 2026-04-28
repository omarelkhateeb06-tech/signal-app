// Phase 12e.5a — thin wrapper over `callHaikuForCommentary` for the
// fact-extraction stage. Mirrors `haikuRelevanceClient.ts` byte-for-byte
// in shape; only the defaults differ (max-tokens budget is 800 instead
// of 400 because the facts payload is larger).
//
// Differences from `callHaikuForCommentary` defaults:
//   - assistantPrefill defaults to "{" so the model returns JSON.
//   - maxTokens defaults to FACTS_DEFAULT_MAX_TOKENS = 800 (5–8 facts ×
//     ~30–60 output tokens each + JSON envelope ≈ 300–500 tokens; 800
//     is comfortable headroom against mid-JSON truncation).
//   - All other knobs (timeout, model, retries) inherit from the
//     underlying client.
//
// Failure handling and the discriminated-union return shape match
// `callHaikuForCommentary` exactly. Caller (factsSeam.ts) parses the
// returned text as JSON and decides retry semantics.

import {
  callHaikuForCommentary,
  type HaikuClientDeps,
  type HaikuResult,
} from "./haikuCommentaryClient";
import {
  FACTS_DEFAULT_MAX_TOKENS,
  FACTS_PROMPT_ASSISTANT_PREFILL,
} from "../llm/prompts/ingestion/factExtraction";

export interface HaikuFactsCallOptions {
  // Override the JSON-prefill nudge. Default "{". The facts seam
  // upgrades to a stricter prefill on parse-retry.
  assistantPrefill?: string;
  // Override the per-call max tokens. Default 800.
  maxTokens?: number;
  // Override the per-call timeout. Defaults to the underlying client's
  // HAIKU_TIMEOUT_MS (10 s).
  timeoutMs?: number;
}

export async function callHaikuForFacts(
  prompt: string,
  opts: HaikuFactsCallOptions = {},
  deps: HaikuClientDeps = {},
): Promise<HaikuResult> {
  return callHaikuForCommentary(
    prompt,
    { ...deps, timeoutMs: opts.timeoutMs ?? deps.timeoutMs },
    {
      assistantPrefill: opts.assistantPrefill ?? FACTS_PROMPT_ASSISTANT_PREFILL,
      maxTokens: opts.maxTokens ?? FACTS_DEFAULT_MAX_TOKENS,
    },
  );
}
