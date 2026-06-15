// "The Through-Line" — thin Anthropic Haiku client for the daily
// editorial-synthesis endpoint (GET /api/v1/briefing/through-line).
//
// Mirrors services/haikuCommentaryClient.ts deliberately rather than
// reusing it — the two call sites carry different prompts, different
// max_tokens budgets, and may diverge on retry policy without one
// dragging the other. What they share is the discipline:
//
//   - Dated model pin: `claude-haiku-4-5-20251001`. Re-exported from
//     the commentary client so "which Haiku served this" stays a single
//     constant across both request paths; the date is in-repo so a
//     commit SHA answers it without a rollout calendar.
//   - 10-second hard timeout via AbortController.
//   - Zero retries. One call, fail fast.
//   - Never throws. Returns a discriminated-union result so the caller
//     routes by reason without catch blocks.
//   - Lazy module-level Anthropic instance so tests can inject their own
//     client via `deps.client` without a real ANTHROPIC_API_KEY.

import Anthropic from "@anthropic-ai/sdk";
import { COMMENTARY_MODEL } from "./haikuCommentaryClient";
import { logLlmUsage } from "../lib/llmCost";

// Re-export the dated pin so both request paths reference one constant.
export const THROUGH_LINE_MODEL = COMMENTARY_MODEL;

// 10,000 ms hard timeout — same envelope as the commentary client.
export const THROUGH_LINE_TIMEOUT_MS = 10_000;

// Modest budget — the Through-Line is 2–3 sentences. ~60 words ×
// ~1.5 tokens/word leaves comfortable headroom at 200.
export const THROUGH_LINE_MAX_TOKENS = 200;

export type ThroughLineFailureReason =
  | "timeout"
  | "empty"
  | "api_error"
  | "no_api_key";

export type ThroughLineClientResult =
  | { ok: true; text: string }
  | { ok: false; reason: ThroughLineFailureReason; detail?: string };

export interface ThroughLineClientDeps {
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
export function __resetThroughLineClientForTests(): void {
  cachedClient = null;
}

/**
 * Call Haiku once with a system + user prompt. Returns a discriminated-
 * union result; never throws. Any SDK error becomes `{ ok: false,
 * reason: "api_error" }` with the raw message in `detail`; an abort
 * becomes `reason: "timeout"`.
 */
export async function callHaikuForThroughLine(
  systemPrompt: string,
  userPrompt: string,
  deps: ThroughLineClientDeps = {},
): Promise<ThroughLineClientResult> {
  const client = deps.client ?? defaultClient();
  if (!client) return { ok: false, reason: "no_api_key" };

  const model = deps.model ?? THROUGH_LINE_MODEL;
  const timeoutMs = deps.timeoutMs ?? THROUGH_LINE_TIMEOUT_MS;
  const maxTokens = deps.maxTokens ?? THROUGH_LINE_MAX_TOKENS;

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
        callSite: "through_line",
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
