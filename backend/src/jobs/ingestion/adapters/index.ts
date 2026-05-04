// Adapter registry. Maps `ingestion_adapter_type` enum values to the
// per-adapter implementation. `getAdapter()` returns null for adapter
// types that have no implementation yet — the poll worker can log and
// move on without throwing during 12e.1 (when none of these are wired
// up). Once 12e.2 lands the RSS adapter, that one returns non-null;
// 12e.5d adds arXiv + SEC EDGAR; 12e.5e adds HN + Reddit.

import type { IngestionAdapterType } from "../../../db/schema";
import type { AdapterFn } from "../types";
import { rssAdapter } from "./rss";
import { arxivAtomAdapter } from "./arxivAtom";
import { secEdgarJsonAdapter } from "./secEdgarJson";
import { hackerNewsAdapter } from "./hackerNews";
import { redditAdapter } from "./reddit";

const REGISTRY: Record<IngestionAdapterType, AdapterFn | null> = {
  rss: rssAdapter,
  arxiv_atom: arxivAtomAdapter,
  sec_edgar_json: secEdgarJsonAdapter,
  hackernews_api: hackerNewsAdapter,
  reddit_api: null,
};

// Suppress "imported but not yet wired" noise — the reddit adapter
// stays linked here so a future phase only needs to flip the registry
// entry rather than hunt down both an import and a map slot.
void redditAdapter;

export function getAdapter(type: IngestionAdapterType): AdapterFn | null {
  return REGISTRY[type];
}
