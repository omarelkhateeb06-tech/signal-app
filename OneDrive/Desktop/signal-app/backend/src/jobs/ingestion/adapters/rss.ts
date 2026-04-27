// RSS / Atom adapter — stub. Implementation lands in 12e.2 (generic
// rss-parser-driven fetch + URL canonicalization + content-hash dedup).
// Throws if invoked so the worker layer can surface "no adapter for
// this source" cleanly during 12e.1 boot.

import type { AdapterContext, AdapterResult } from "../types";

export async function rssAdapter(_ctx: AdapterContext): Promise<AdapterResult> {
  throw new Error("rss adapter not yet implemented (Phase 12e.2)");
}
