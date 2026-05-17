// Hacker News API adapter (Phase 12e.5e).
//
// Two-phase fetch: topstories list → per-item detail. Accepts:
//   - external-link stories — `url` points off-site, behaves like any
//     other source.
//   - self-posts (Ask HN / Show HN) — `url` empty, `text` carries the
//     post body. source_url is the HN thread page; the post body is
//     stripped to plain text and passed downstream as pre-fetched
//     content so the heuristic seam skips fetch+readability on the
//     thread page (which is HN nav chrome, not the post body).
//
// Filter: score >= HN_MIN_SCORE, type=story, not dead/deleted. No
// domain whitelist — the LLM relevance gate (12e.4) handles off-sector
// filtering downstream.
//
// Concurrency: item fetches run in batches of HN_FETCH_CONCURRENCY to
// stay within Firebase's undocumented rate limits while keeping the
// 4-hour poll cycle fast enough to matter.
//
// Failure strings: timeout | network | http_4xx | http_5xx | parse_error

import crypto from "node:crypto";
import type { AdapterContext, AdapterResult, Candidate } from "../types";

const FETCH_TIMEOUT_MS = 30_000;
const USER_AGENT = "SIGNAL/12e.5e (+contact@signal.so)";
const HN_MIN_SCORE = 100;
const HN_TOP_IDS_CAP = 150;
const HN_FETCH_CONCURRENCY = 10;
const HN_BASE = "https://hacker-news.firebaseio.com/v0";

function sha256Truncated(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex").slice(0, 32);
}

function classifyFetchError(err: unknown): "timeout" | "network" {
  return (err as { name?: string }).name === "AbortError" ? "timeout" : "network";
}

async function fetchJson<T>(url: string): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: ctrl.signal,
      });
    } catch (err) {
      throw new Error(classifyFetchError(err));
    }
    if (res.status >= 400 && res.status < 500) throw new Error("http_4xx");
    if (res.status >= 500) throw new Error("http_5xx");
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

interface HnItem {
  id: number;
  type?: string;
  title?: string;
  url?: string;
  text?: string;
  score?: number;
  time?: number;
  dead?: boolean;
  deleted?: boolean;
}

function hasUrl(item: HnItem): boolean {
  return typeof item.url === "string" && item.url.trim().length > 0;
}

function hasText(item: HnItem): boolean {
  return typeof item.text === "string" && item.text.trim().length > 0;
}

function isUsableItem(item: HnItem): boolean {
  if (item.dead || item.deleted) return false;
  if (item.type !== "story") return false;
  // Either an external link or a self-post with body text. An item
  // with neither is unusable (a deleted Ask HN, a story marker with
  // no payload, etc).
  if (!hasUrl(item) && !hasText(item)) return false;
  if ((item.score ?? 0) < HN_MIN_SCORE) return false;
  return true;
}

// Minimal HTML → plain text. HN self-post bodies carry a small tag
// set (<p>, <br>, <a>, <code>, <pre>, <i>) and the standard XML
// entity set. We turn block-level breaks into newlines, strip the
// rest, and decode the entities Firebase actually emits. This is not
// a general HTML sanitizer — it's a targeted normalizer for the HN
// `text` field so it matches the readability-extracted plain text
// shape that the downstream stages expect on body_text.
function htmlToPlainText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*\/\s*p\s*>/gi, "\n\n")
    .replace(/<\s*p[^>]*>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function fetchItemBatch(ids: number[]): Promise<HnItem[]> {
  const results = await Promise.allSettled(
    ids.map((id) => fetchJson<HnItem>(`${HN_BASE}/item/${id}.json`)),
  );
  return results
    .filter((r): r is PromiseFulfilledResult<HnItem> => r.status === "fulfilled")
    .map((r) => r.value)
    .filter((item): item is HnItem => item !== null);
}

function buildCandidate(item: HnItem): Candidate {
  const externalId = String(item.id);
  const title = item.title ?? null;
  const publishedAt = item.time ? new Date(item.time * 1000) : null;
  const isSelfPost = !hasUrl(item);

  const url = isSelfPost
    ? `https://news.ycombinator.com/item?id=${item.id}`
    : item.url!;

  const bodyText = isSelfPost && item.text ? htmlToPlainText(item.text) : null;

  // Stamp the community-post flag onto the persisted payload so a
  // downstream consumer (debugging, future surface-level treatment)
  // can tell self-posts from external links without re-deriving from
  // `url`/`text`. The raw HN item already lives here unchanged.
  const rawPayload: Record<string, unknown> = { ...(item as unknown as Record<string, unknown>) };
  if (isSelfPost) rawPayload.is_community_post = true;

  return {
    externalId,
    url,
    title,
    summary: null,
    publishedAt,
    contentHash: sha256Truncated(`${url}\n${title ?? ""}`),
    bodyText,
    rawPayload,
  };
}

export async function hackerNewsAdapter(_ctx: AdapterContext): Promise<AdapterResult> {
  // Fetch topstory IDs.
  let topIds: number[];
  try {
    topIds = await fetchJson<number[]>(`${HN_BASE}/topstories.json`);
  } catch (err) {
    // Re-throw with stable failure string so sourcePollJob classifies correctly.
    throw err instanceof Error ? err : new Error("network");
  }

  if (!Array.isArray(topIds)) throw new Error("parse_error");

  const candidateIds = topIds.slice(0, HN_TOP_IDS_CAP);

  // Fetch item details in concurrent batches.
  const candidates: Candidate[] = [];
  for (let i = 0; i < candidateIds.length; i += HN_FETCH_CONCURRENCY) {
    const batch = candidateIds.slice(i, i + HN_FETCH_CONCURRENCY);
    const items = await fetchItemBatch(batch);
    for (const item of items) {
      if (!isUsableItem(item)) continue;
      candidates.push(buildCandidate(item));
    }
  }

  return { candidates };
}
