// Phase 12c — thin Anthropic Haiku client for commentary generation.
// Phase 12d — extended (signature only) for assistant prefill and a
// per-call max_tokens override; the call shape and error handling are
// unchanged.
//
// Intentionally minimal:
//   - Dated model string: `claude-haiku-4-5-20251001` (locked per the
//     12c ground rules; the generic "claude-haiku-4-5" alias used in
//     12a remains only in the regeneration script path).
//   - 10-second hard timeout per call. Wrapped with AbortController so
//     a stalled Anthropic endpoint can't stall a feed render.
//   - No retries here. The caller (commentaryService) handles parse-
//     failure retries; transport-level failures fall straight through
//     to the tiered template.
//   - Never throws. Returns a discriminated-union result so the caller
//     can route by reason without catch blocks.
//   - 12d: when `assistantPrefill` is set, the prefill is sent as a
//     leading assistant turn and prepended to the returned text. This
//     is the supported way to bias the model toward a target output
//     prefix (e.g. "{" to force JSON). The model's response text does
//     not include the prefill — we re-attach it so downstream parsers
//     see the full intended payload.
//
// Module-level Anthropic instance is lazy so tests can inject their
// own client via `callHaikuForCommentary`'s deps arg without
// stumbling over a missing ANTHROPIC_API_KEY.

import Anthropic from "@anthropic-ai/sdk";

// Pinned dated model. Do not replace with the alias — keeping the date
// in-repo means "which model served this commentary" is answerable
// from a commit SHA without consulting rollout calendars.
export const COMMENTARY_MODEL = "claude-haiku-4-5-20251001";

// 10,000 ms hard timeout. Chosen to be short enough that a single
// stalled request can't hold a feed row's commentary spinner open long
// enough for the user to notice, long enough that normal P99 latency
// (~3–5 s at Haiku prices) passes comfortably. Raise only with an
// explicit product decision.
export const HAIKU_TIMEOUT_MS = 10_000;

// 12d: bumped from 600 → 800. Technical depth at 20% over budget
// (~210 words) × ~1.5 tokens/word for jargon-heavy output + JSON
// envelope ≈ 330 tokens; 600 was tight on tail cases and the failure
// mode (silent truncation mid-JSON) is much worse than 200 wasted
// tokens per call.
export const HAIKU_MAX_TOKENS = 800;

export type HaikuFailureReason =
  | "timeout"
  | "empty"
  | "api_error"
  | "no_api_key";

export type HaikuResult =
  | { ok: true; text: string }
  | { ok: false; reason: HaikuFailureReason; detail?: string };

export interface HaikuClientDeps {
  client?: Pick<Anthropic["messages"], "create">;
  model?: string;
  timeoutMs?: number;
}

export interface HaikuCallOptions {
  // Assistant-side prefill. When set, sent as a second message with
  // `role: "assistant"` and prepended to the returned text. The
  // canonical use is `"{"` to bias the model toward emitting JSON.
  assistantPrefill?: string;
  // Override the default `HAIKU_MAX_TOKENS`. Service layer may pass a
  // smaller value for a retry that's already known to be tighter, or
  // a larger value for an experimental depth.
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
export function __resetHaikuClientForTests(): void {
  cachedClient = null;
}

/**
 * Call Haiku once with the given prompt. Returns a discriminated-union
 * result. Never throws; any SDK error becomes `{ ok: false,
 * reason: "api_error" }` with the raw message in `detail`.
 *
 * When `opts.assistantPrefill` is set, the returned text has the
 * prefill prepended so JSON parsers downstream see the full intended
 * payload (the API's `content` blocks contain only the model's
 * continuation, not the prefill itself).
 */
export async function callHaikuForCommentary(
  prompt: string,
  deps: HaikuClientDeps = {},
  opts: HaikuCallOptions = {},
): Promise<HaikuResult> {
  const client = deps.client ?? defaultClient();
  if (!client) return { ok: false, reason: "no_api_key" };

  const model = deps.model ?? COMMENTARY_MODEL;
  const timeoutMs = deps.timeoutMs ?? HAIKU_TIMEOUT_MS;
  const maxTokens = opts.maxTokens ?? HAIKU_MAX_TOKENS;
  const prefill = opts.assistantPrefill;

  // Build message array. With prefill the model's continuation is
  // appended to the prefill content from the model's perspective; the
  // API still returns only the new tokens, so we prepend ourselves
  // below.
  const messages: Array<{ role: "user" | "assistant"; content: string }> =
    prefill !== undefined
      ? [
          { role: "user", content: prompt },
          { role: "assistant", content: prefill },
        ]
      : [{ role: "user", content: prompt }];

  // AbortController drives both the SDK's `signal` and our own race
  // so we emit a deterministic "timeout" reason rather than letting
  // the SDK surface a less specific AbortError downstream.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await client.create(
      {
        model,
        max_tokens: maxTokens,
        messages,
      },
      { signal: controller.signal },
    );
    const continuation = res.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("\n")
      .trim();
    if (!continuation) return { ok: false, reason: "empty" };
    const text = prefill !== undefined ? prefill + continuation : continuation;
    return { ok: true, text };
  } catch (err) {
    // AbortError surfaces as a DOMException on modern Node; shape-check
    // rather than instanceof to avoid cross-realm pitfalls under test.
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
