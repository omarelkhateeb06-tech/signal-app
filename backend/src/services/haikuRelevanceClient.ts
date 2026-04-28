// Phase 12e.4 — thin wrapper over `callHaikuForCommentary` for the LLM
// relevance gate. The underlying client (haikuCommentaryClient.ts) was
// originally named for the 12c personalization use case; renaming it
// is out of scope (Stage 1 §C, gap 1). This wrapper disambiguates by
// name without touching the 12c call path.
//
// Differences from `callHaikuForCommentary` defaults:
//   - assistantPrefill defaults to "{" so the model returns JSON.
//   - maxTokens defaults to 400 (relevance verdict is short:
//     boolean + sector + 1–2 sentence reason ≈ 100 output tokens; 400
//     is a comfortable headroom).
//   - All other knobs (timeout, model, retries) inherit from the
//     underlying client.
//
// Failure handling and the discriminated-union return shape match
// `callHaikuForCommentary` exactly. Caller (relevanceSeam.ts) parses
// the returned text as JSON and decides retry semantics.

import {
  callHaikuForCommentary,
  type HaikuClientDeps,
  type HaikuResult,
} from "./haikuCommentaryClient";

export const RELEVANCE_DEFAULT_MAX_TOKENS = 400;

export interface HaikuRelevanceCallOptions {
  // Override the JSON-prefill nudge. Default "{". The relevance seam
  // upgrades to a stricter prefill on parse-retry.
  assistantPrefill?: string;
  // Override the per-call max tokens. Default 400.
  maxTokens?: number;
  // Override the per-call timeout. Defaults to the underlying client's
  // HAIKU_TIMEOUT_MS (10 s).
  timeoutMs?: number;
}

export async function callHaikuForRelevance(
  prompt: string,
  opts: HaikuRelevanceCallOptions = {},
  deps: HaikuClientDeps = {},
): Promise<HaikuResult> {
  return callHaikuForCommentary(
    prompt,
    { ...deps, timeoutMs: opts.timeoutMs ?? deps.timeoutMs },
    {
      assistantPrefill: opts.assistantPrefill ?? "{",
      maxTokens: opts.maxTokens ?? RELEVANCE_DEFAULT_MAX_TOKENS,
    },
  );
}
