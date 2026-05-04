// Hacker News API adapter (Phase 12e.5e).
//
// Two-phase fetch: topstories list → per-item detail. Filters to
// story-type items with score >= HN_MIN_SCORE and an external URL.
// No domain whitelist — the LLM relevance gate (12e.4) handles
// off-sector filtering.
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
  score?: number;
  time?: number;
  dead?: boolean;
  deleted?: boolean;
}

function isUsableItem(item: HnItem): boolean {
  if (item.dead || item.deleted) return false;
  if (item.type !== "story") return false;
  if (!item.url || item.url.trim().length === 0) return false;
  if ((item.score ?? 0) < HN_MIN_SCORE) return false;
  return true;
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
      const url = item.url!;
      const title = item.title ?? null;
      const externalId = String(item.id);
      const publishedAt = item.time ? new Date(item.time * 1000) : null;
      const contentHash = sha256Truncated(`${url}\n${title ?? ""}`);
      candidates.push({
        externalId,
        url,
        title,
        summary: null,
        publishedAt,
        contentHash,
        rawPayload: item as unknown as Record<string, unknown>,
      });
    }
  }

  return { candidates };
}
