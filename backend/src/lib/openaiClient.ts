// Lazy singleton OpenAI client. Mirrors the Anthropic pattern in
// services/haikuCommentaryClient.ts: read OPENAI_API_KEY from process.env
// on first access, return null if absent so the caller (the embedding
// seam) can degrade gracefully rather than crash on missing credentials.
//
// 12e.6a — used by the embedding seam to call text-embedding-3-small
// post-relevance-gate. Production will surface a missing key via
// PROD_REQUIRED_ENV_VARS in lib/envCheck.ts.

import OpenAI from "openai";

let cachedClient: OpenAI | null = null;

export function getOpenAIClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  if (!cachedClient) cachedClient = new OpenAI({ apiKey });
  return cachedClient;
}

// Exported for tests — resets the cached client after an env mutation.
export function __resetOpenAIClientForTests(): void {
  cachedClient = null;
}
