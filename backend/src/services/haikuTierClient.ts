// Phase 12e.5b — thin wrapper over `callHaikuForCommentary` for the
// tier-generation stage. Mirrors `haikuFactsClient.ts` in shape; the
// only meaningful divergence is the per-tier max-tokens budget — the
// asymmetric ceilings (300 / 400 / 500) track the per-tier word budgets
// already locked into 12c/12d (commentaryPromptV2.ts) and the 12e.5b
// stage 1 audit's tokens-per-word working assumptions.
//
// Differences from `callHaikuForCommentary` defaults:
//   - assistantPrefill defaults to "{" so the model returns JSON.
//   - maxTokens defaults to the per-tier ceiling (TIER_*_DEFAULT_MAX_TOKENS).
//   - All other knobs (timeout, model, retries) inherit from the
//     underlying client.
//
// Failure handling and the discriminated-union return shape match
// `callHaikuForCommentary` exactly. Caller (tierGenerationSeam.ts)
// parses the returned text as JSON and decides retry semantics.

import {
  callHaikuForCommentary,
  type HaikuClientDeps,
  type HaikuResult,
} from "./haikuCommentaryClient";
import {
  TIER_ACCESSIBLE_ASSISTANT_PREFILL,
  TIER_ACCESSIBLE_DEFAULT_MAX_TOKENS,
} from "../llm/prompts/ingestion/tierAccessible";
import {
  TIER_BRIEFED_ASSISTANT_PREFILL,
  TIER_BRIEFED_DEFAULT_MAX_TOKENS,
} from "../llm/prompts/ingestion/tierBriefed";
import {
  TIER_TECHNICAL_ASSISTANT_PREFILL,
  TIER_TECHNICAL_DEFAULT_MAX_TOKENS,
} from "../llm/prompts/ingestion/tierTechnical";

export type TierName = "accessible" | "briefed" | "technical";

export interface HaikuTierCallOptions {
  // Override the per-call timeout. Defaults to the underlying client's
  // HAIKU_TIMEOUT_MS (10 s).
  timeoutMs?: number;
  // Override the per-call max tokens. Defaults to the per-tier ceiling.
  maxTokens?: number;
  // Override the JSON-prefill nudge. Defaults to "{". The seam upgrades
  // to a stricter prefill on parse-retry.
  prefill?: string;
}

interface TierDefaults {
  prefill: string;
  maxTokens: number;
}

function defaultsForTier(tier: TierName): TierDefaults {
  switch (tier) {
    case "accessible":
      return {
        prefill: TIER_ACCESSIBLE_ASSISTANT_PREFILL,
        maxTokens: TIER_ACCESSIBLE_DEFAULT_MAX_TOKENS,
      };
    case "briefed":
      return {
        prefill: TIER_BRIEFED_ASSISTANT_PREFILL,
        maxTokens: TIER_BRIEFED_DEFAULT_MAX_TOKENS,
      };
    case "technical":
      return {
        prefill: TIER_TECHNICAL_ASSISTANT_PREFILL,
        maxTokens: TIER_TECHNICAL_DEFAULT_MAX_TOKENS,
      };
  }
}

export async function callHaikuForTier(
  prompt: string,
  tier: TierName,
  opts: HaikuTierCallOptions = {},
  deps: HaikuClientDeps = {},
): Promise<HaikuResult> {
  const tierDefaults = defaultsForTier(tier);
  return callHaikuForCommentary(
    prompt,
    { ...deps, timeoutMs: opts.timeoutMs ?? deps.timeoutMs },
    {
      assistantPrefill: opts.prefill ?? tierDefaults.prefill,
      maxTokens: opts.maxTokens ?? tierDefaults.maxTokens,
    },
  );
}
