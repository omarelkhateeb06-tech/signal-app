// Hacker News API adapter — stub. Implementation lands in 12e.5e
// (pull /v0/topstories, filter by domain whitelist + minimum score,
// 4-hour cadence).

import type { AdapterContext, AdapterResult } from "../types";

export async function hackerNewsAdapter(_ctx: AdapterContext): Promise<AdapterResult> {
  throw new Error("hackernews_api adapter not yet implemented (Phase 12e.5e)");
}
