// Belief-match Haiku client — judges whether a recent development materially
// challenges a reader's stated belief. Mirrors throughLineClient.ts rather
// than reusing it: distinct call site (its own cost label), its own
// max_tokens budget, may diverge on retry policy. Shared discipline:
//
//   - Dated model pin: `claude-haiku-4-5-20251001` (re-exported from the
//     commentary client so "which Haiku served this" is one constant).
//   - 10-second hard timeout via AbortController.
//   - Zero retries. One call, fail fast.
//   - Never throws. Returns a discriminated-union result.
//   - Lazy module-level Anthropic instance so tests inject `deps.client`.

import Anthropic from "@anthropic-ai/sdk";
import { COMMENTARY_MODEL } from "./haikuCommentaryClient";
import { logLlmUsage } from "../lib/llmCost";

export const BELIEF_MATCH_MODEL = COMMENTARY_MODEL;
export const BELIEF_MATCH_TIMEOUT_MS = 10_000;

// Room for a small JSON verdict per belief (challenged flag, event index,
// how-to-update, dissent). ~150 tokens of content; 400 is comfortable.
export const BELIEF_MATCH_MAX_TOKENS = 400;

export type BeliefMatchFailureReason =
  | "timeout"
  | "empty"
  | "api_error"
  | "no_api_key";

export type BeliefMatchClientResult =
  | { ok: true; text: string }
  | { ok: false; reason: BeliefMatchFailureReason; detail?: string };

export interface BeliefMatchClientDeps {
  client?: Pick<Anthropic["messages"], "create">;
  model?: string;
  timeoutMs?: number;
  maxTokens?: number;
}

let cachedClient: Anthropic | null = null;
function defaultClient(): Pick<Anthropic["messages"], "create"> | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  if (!cachedClient) cachedClient = new Anthropic({ apiKey });
  return cachedClient.messages;
}

// Exported for tests — resets the cached client after an env mutation.
export function __resetBeliefMatchClientForTests(): void {
  cachedClient = null;
}

/**
 * Call Haiku once with a system + user prompt. Returns a discriminated-union
 * result; never throws. SDK error → `api_error`; abort → `timeout`.
 */
export async function callHaikuForBeliefMatch(
  systemPrompt: string,
  userPrompt: string,
  deps: BeliefMatchClientDeps = {},
): Promise<BeliefMatchClientResult> {
  const client = deps.client ?? defaultClient();
  if (!client) return { ok: false, reason: "no_api_key" };

  const model = deps.model ?? BELIEF_MATCH_MODEL;
  const timeoutMs = deps.timeoutMs ?? BELIEF_MATCH_TIMEOUT_MS;
  const maxTokens = deps.maxTokens ?? BELIEF_MATCH_MAX_TOKENS;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await client.create(
      {
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      },
      { signal: controller.signal },
    );
    const usage = (res as { usage?: { input_tokens?: number; output_tokens?: number } })
      .usage;
    if (usage && typeof usage.input_tokens === "number") {
      logLlmUsage({
        provider: "anthropic",
        callSite: "belief_match",
        model,
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens ?? 0,
      });
    }
    const text = res.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("\n")
      .trim();
    if (!text) return { ok: false, reason: "empty" };
    return { ok: true, text };
  } catch (err) {
    const name = (err as { name?: string } | null)?.name;
    if (name === "AbortError" || controller.signal.aborted) {
      return { ok: false, reason: "timeout" };
    }
    const message =
      err instanceof Error ? err.message : String(err ?? "unknown error");
    return { ok: false, reason: "api_error", detail: message };
  } finally {
    clearTimeout(timeout);
  }
}
