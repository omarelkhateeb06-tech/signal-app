// arXiv Atom API adapter (Phase 12e.5d).
//
// Fetches the pre-seeded Atom endpoint (cs.AI + cs.CL + cs.LG, sorted
// by submittedDate descending) and emits up to ARXIV_VOLUME_CAP candidates
// per cycle. Volume cap is the primary cost-control mechanism — the daily
// cadence means a single cycle can surface 100+ papers; the LLM relevance
// gate runs one Haiku call per surviving candidate.
//
// Failure strings (stable contract with sourcePollJob):
//   timeout | network | http_4xx | http_5xx | parse_error

import crypto from "node:crypto";
import Parser from "rss-parser";
import type { AdapterContext, AdapterResult, Candidate } from "../types";

const FETCH_TIMEOUT_MS = 30_000;
const ARXIV_VOLUME_CAP = 20;
const USER_AGENT = "SIGNAL/12e.5d (+contact@signal.so)";

function sha256Truncated(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex").slice(0, 32);
}

// arXiv entry ids look like "http://arxiv.org/abs/2301.00001v2".
// Strip to the bare paper id ("2301.00001") — version suffix excluded so
// v1 and v2 of the same paper dedup against the same external_id.
function extractArxivId(rawId: string): string {
  const match = /abs\/([^v]+)/.exec(rawId);
  return match?.[1]?.trim() ?? sha256Truncated(rawId);
}

function classifyFetchError(err: unknown): "timeout" | "network" {
  return (err as { name?: string }).name === "AbortError" ? "timeout" : "network";
}

export async function arxivAtomAdapter(ctx: AdapterContext): Promise<AdapterResult> {
  if (!ctx.endpoint) throw new Error("network");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  let body: string;
  try {
    let res: Response;
    try {
      res = await fetch(ctx.endpoint, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/atom+xml, */*" },
        signal: ctrl.signal,
      });
    } catch (err) {
      throw new Error(classifyFetchError(err));
    }
    if (res.status >= 400 && res.status < 500) throw new Error("http_4xx");
    if (res.status >= 500) throw new Error("http_5xx");
    body = await res.text();
  } finally {
    clearTimeout(timer);
  }

  const parser = new Parser();
  let feed: Awaited<ReturnType<typeof parser.parseString>>;
  try {
    feed = await parser.parseString(body);
  } catch {
    throw new Error("parse_error");
  }

  const candidates: Candidate[] = [];
  for (const item of feed.items.slice(0, ARXIV_VOLUME_CAP)) {
    const rawId = (item as { id?: string }).id ?? item.guid ?? "";
    const externalId =
      rawId.length > 0 ? extractArxivId(rawId) : sha256Truncated(item.link ?? "");
    const url = item.link ?? `https://arxiv.org/abs/${externalId}`;
    const title = item.title?.trim() ?? null;
    // rss-parser populates Atom <summary> into the `summary` field; some
    // Atom variants also surface `<content>` and rss-parser may set
    // `contentSnippet` when an HTML body is present. Try in that order.
    const summary =
      item.contentSnippet?.trim() ||
      item.content?.trim() ||
      item.summary?.trim() ||
      null;
    // arXiv Atom uses isoDate (normalized updated field).
    const publishedAt = item.isoDate ? new Date(item.isoDate) : null;
    const contentHash = sha256Truncated(`${url}\n${title ?? ""}\n${summary ?? ""}`);

    candidates.push({
      externalId,
      url,
      title,
      summary,
      publishedAt,
      contentHash,
      rawPayload: item as unknown as Record<string, unknown>,
    });
  }

  return { candidates };
}
