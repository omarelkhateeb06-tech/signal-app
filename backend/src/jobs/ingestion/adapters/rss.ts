// Generic RSS / Atom adapter for the ingestion pipeline (Phase 12e.2).
//
// Fetches the source's `endpoint` with the configured User-Agent, parses
// with `rss-parser`, and emits one `Candidate` per item. Pure of DB —
// the worker layer at `sourcePollJob.ts` handles persistence and source
// row updates.
//
// Per-source User-Agent override:
//   ingestion_sources.config.userAgent (string) overrides the default
//   `SIGNAL/12e.2 (+contact@signal.so)`. Use for sites that bot-block a
//   generic library UA (TSMC, etc.). Keep default for everything else;
//   honest identification beats trying to look like a browser.
//
// Failure classification — adapter throws an `Error` whose .message is
// one of:
//   timeout | http_4xx | http_5xx | wrong_content_type | parse_error | network
// The worker reads .message verbatim into `failureReason` on the source
// row. Keep these strings stable; they're effectively a public contract.
//
// Dedup is a worker concern (UNIQUE on `(ingestion_source_id, external_id)`)
// — this adapter just emits candidates, including duplicates within a
// single fetch (rare in practice; possible from misbehaving feeds).

import crypto from "node:crypto";
import Parser from "rss-parser";

import type { AdapterContext, AdapterResult, Candidate } from "../types";
import { canonicalizeUrl } from "../../../utils/url";
import { stripHtml } from "../../../utils/htmlStrip";

const DEFAULT_USER_AGENT = "SIGNAL/12e.2 (+contact@signal.so)";
const FETCH_TIMEOUT_MS = 30_000;

const ACCEPTED_CONTENT_TYPES = [
  "application/rss+xml",
  "application/xml",
  "application/atom+xml",
  "text/xml",
];

function pickUserAgent(config: Record<string, unknown>): string {
  const override = config.userAgent;
  if (typeof override === "string" && override.length > 0) return override;
  return DEFAULT_USER_AGENT;
}

function classifyFetchError(err: unknown): "timeout" | "network" {
  const e = err as { name?: string };
  if (e.name === "AbortError") return "timeout";
  return "network";
}

function isAcceptedContentType(header: string | null): boolean {
  if (!header) return false;
  // header may be "text/xml; charset=utf-8" — match on the type part only.
  const type = header.split(";")[0]?.trim().toLowerCase() ?? "";
  return ACCEPTED_CONTENT_TYPES.includes(type);
}

function sha256Truncated(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex").slice(0, 32);
}

function externalIdFor(item: { guid?: string; link?: string; pubDate?: string }): string {
  if (item.guid && item.guid.length > 0) return item.guid;
  // Fallback: hash(link + pubDate). Either may be missing — treat as
  // empty string. Items with neither won't dedup against re-fetches but
  // also can't really be addressed; the rss-parser shape guarantees at
  // least one is usually present.
  return sha256Truncated((item.link ?? "") + (item.pubDate ?? ""));
}

function pickSummary(item: {
  contentSnippet?: string;
  content?: string;
  summary?: string;
}): string | null {
  // 12e.x: strip HTML tags + decode entities at ingestion. rss-parser's
  // contentSnippet is already mostly text but some feeds (SEC EDGAR Atom
  // in particular) put `<b>Filed:</b><a href=...>` in `content`. Without
  // this, the literal markup ends up in stories.summary and renders as
  // raw text on the frontend.
  const raw = item.contentSnippet ?? item.content ?? item.summary ?? null;
  return stripHtml(raw);
}

function parsePubDate(raw: string | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function rssAdapter(ctx: AdapterContext): Promise<AdapterResult> {
  if (!ctx.endpoint) {
    throw new Error("network");
  }

  const ua = pickUserAgent(ctx.config);

  // Fetch.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  let body: string;
  try {
    let res: Response;
    try {
      res = await fetch(ctx.endpoint, {
        headers: {
          "User-Agent": ua,
          Accept:
            "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
        },
        signal: ctrl.signal,
      });
    } catch (err) {
      throw new Error(classifyFetchError(err));
    }

    if (res.status >= 400 && res.status < 500) throw new Error("http_4xx");
    if (res.status >= 500 && res.status < 600) throw new Error("http_5xx");
    if (res.status < 200 || res.status >= 300) throw new Error("network");

    if (!isAcceptedContentType(res.headers.get("content-type"))) {
      // Drain the body so the connection can close cleanly even when we reject.
      try {
        await res.text();
      } catch {
        /* ignore */
      }
      throw new Error("wrong_content_type");
    }

    body = await res.text();
  } finally {
    clearTimeout(timer);
  }

  // Parse.
  const parser = new Parser();
  let feed: Awaited<ReturnType<typeof parser.parseString>>;
  try {
    feed = await parser.parseString(body);
  } catch {
    throw new Error("parse_error");
  }

  // Normalize.
  const candidates: Candidate[] = [];
  for (const item of feed.items) {
    const rawLink = item.link ?? "";
    let url = rawLink;
    if (rawLink.length > 0) {
      try {
        url = canonicalizeUrl(rawLink);
      } catch {
        // Malformed URL — keep raw; the candidate row still gets persisted.
        url = rawLink;
      }
    }

    const title = item.title && item.title.length > 0 ? item.title : null;
    const summary = pickSummary(item);
    const publishedAt = parsePubDate(item.pubDate);
    const externalId = externalIdFor(item);
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
