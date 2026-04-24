// Phase 12c — thin Anthropic Haiku client for commentary generation.
//
// Intentionally minimal:
//   - Dated model string: `claude-haiku-4-5-20251001` (locked per the
//     12c ground rules; the generic "claude-haiku-4-5" alias used in
//     12a remains only in the regeneration script path).
//   - 10-second hard timeout per call. Wrapped with AbortController so
//     a stalled Anthropic endpoint can't stall a feed render.
//   - No retries in 12c. One call; on any failure, we fall back to the
//     tiered template. Revisit in 12d if observability says the
//     failure rate is high enough to warrant a single retry on 5xx.
//   - Never throws. Returns a discriminated-union result so the caller
//     can route by reason without catch blocks.
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
 */
export async function callHaikuForCommentary(
  prompt: string,
  deps: HaikuClientDeps = {},
): Promise<HaikuResult> {
  const client = deps.client ?? defaultClient();
  if (!client) return { ok: false, reason: "no_api_key" };

  const model = deps.model ?? COMMENTARY_MODEL;
  const timeoutMs = deps.timeoutMs ?? HAIKU_TIMEOUT_MS;

  // AbortController drives both the SDK's `signal` and our own race
  // so we emit a deterministic "timeout" reason rather than letting
  // the SDK surface a less specific AbortError downstream.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await client.create(
      {
        model,
        max_tokens: 600,
        messages: [{ role: "user", content: prompt }],
      },
      { signal: controller.signal },
    );
    const text = res.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("\n")
      .trim();
    if (!text) return { ok: false, reason: "empty" };
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
