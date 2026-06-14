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
import { secFormDAdapter } from "./secFormD";
import { hackerNewsAdapter } from "./hackerNews";
import { redditAdapter } from "./reddit";
import { githubAdapter } from "./github";
import { fredApiAdapter } from "./fredApi";
import { sitemapAdapter } from "./sitemap";

const REGISTRY: Record<IngestionAdapterType, AdapterFn | null> = {
  rss: rssAdapter,
  arxiv_atom: arxivAtomAdapter,
  sec_edgar_json: secEdgarJsonAdapter,
  // Phase 12 ingestion Tier 1 — Form D private-financing discovery
  // (content_type='filing'). Discovery stream, not a CIK watch like
  // sec_edgar_json; the Haiku relevance gate assigns the sector.
  sec_form_d: secFormDAdapter,
  hackernews_api: hackerNewsAdapter,
  // Phase 12 ingestion — top-of-day posts from a fixed subreddit list
  // (OAuth client-credentials). Requires REDDIT_CLIENT_ID/SECRET and
  // logs-and-skips when unset.
  reddit_api: redditAdapter,
  // Phase 12R.A — direct GitHub repo polling (WORTH AN AFTERNOON card).
  github_api: githubAdapter,
  // Phase 12 ingestion Tier 1 — FRED macro data cards (content_type=
  // 'filing'). One compact data card per series release; requires
  // FRED_API_KEY and logs-and-skips when it is unset.
  fred_api: fredApiAdapter,
  // Phase 12 ingestion — sitemap.xml article discovery for primaries with no
  // usable RSS (wired today for anthropic-news; general fallback otherwise).
  sitemap: sitemapAdapter,
  // Phase 12n.2 — native posts are AUTHORED, not pulled off a feed.
  // They never run through the poll/adapter path; the native generator
  // registry (generators/index.ts) owns them. Null here keeps the
  // adapter map exhaustive over the enum without implying a feed adapter.
  native_generator: null,
};

export function getAdapter(type: IngestionAdapterType): AdapterFn | null {
  return REGISTRY[type];
}
