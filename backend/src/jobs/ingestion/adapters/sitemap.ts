// Sitemap adapter — discovery of long-form articles from sites that
// publish a sitemap but no usable RSS/Atom feed.
//
// Motivation: some tier-1 primaries (Anthropic, in particular) killed their
// RSS endpoint but still expose a standards `sitemap.xml`. The RSS-bridge
// path is a dead end for them — there is no feed — and the short-form social
// bridge (Bluesky etc.) is a dead end for a different reason (the body seam's
// 500-char floor). A sitemap, by contrast, lists the canonical URLs of
// full-length article pages: the adapter emits one candidate per recent
// article, and the existing heuristic body seam fetches each page and runs
// readability on it (verified: an Anthropic /news/ page is server-rendered
// text/html with ~90k chars of body — it clears the floor trivially).
//
// What this adapter does NOT do: fetch article bodies (that is the body
// seam's job) and does NOT have a per-article title. A sitemap entry is just
// `<loc>` + `<lastmod>`. The adapter derives a human title from the URL slug
// — consistent with how secFormD / secEdgarJson derive titles from structured
// data rather than re-fetching. The slug title reads acceptably under the
// source kicker (e.g. "ANTHROPIC NEWS · Advancing Claude For Education"); an
// og:title fetch is the documented quality upgrade if a future source needs
// it.
//
// Handles both forms:
//   <urlset>       — a flat list of <url> entries (Anthropic).
//   <sitemapindex> — an index of sub-sitemaps; the adapter follows those whose
//                    <loc> matches config.sitemapFilter (OpenAI's shape).
//
// Failure strings (mirrors secFormD): timeout | network | http_4xx | http_5xx
// | wrong_content_type

import crypto from "node:crypto";
import type { AdapterContext, AdapterResult, Candidate } from "../types";
import { canonicalizeUrl } from "../../../utils/url";

const DEFAULT_USER_AGENT = "SIGNAL/12 signal-ingestion (+contact@signal.so)";
const FETCH_TIMEOUT_MS = 30_000;
const INTER_REQUEST_DELAY_MS = 150;

const DEFAULT_LOOKBACK_DAYS = 7;
const DEFAULT_MAX_URLS = 200;
// Bound on sub-sitemaps followed from a <sitemapindex> per poll.
const MAX_SUBSITEMAPS = 8;
// Bytes to read when scanning for og:title — enough to cover <head>.
const OG_TITLE_SCAN_BYTES = 4096;

function sha256Truncated(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex").slice(0, 32);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function classifyFetchError(err: unknown): "timeout" | "network" {
  return (err as { name?: string }).name === "AbortError" ? "timeout" : "network";
}

function pickUserAgent(config: Record<string, unknown>): string {
  const override = config.userAgent;
  return typeof override === "string" && override.length > 0 ? override : DEFAULT_USER_AGENT;
}

const MAX_FETCH_ATTEMPTS = 3;
const RETRYABLE_ERRORS = new Set(["http_5xx", "timeout", "network"]);

async function requestOnce(url: string, ua: string): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          "User-Agent": ua,
          Accept: "application/xml, text/xml, application/rss+xml, */*",
        },
        signal: ctrl.signal,
      });
    } catch (err) {
      throw new Error(classifyFetchError(err));
    }
    if (res.status >= 400 && res.status < 500) throw new Error("http_4xx");
    if (res.status >= 500) throw new Error("http_5xx");
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url: string, ua: string): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt++) {
    try {
      const res = await requestOnce(url, ua);
      return await res.text();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!RETRYABLE_ERRORS.has(msg) || attempt === MAX_FETCH_ATTEMPTS) throw err;
      await sleep(300 * attempt); // 300ms, then 600ms
    }
  }
  throw lastErr;
}

interface SitemapUrl {
  loc: string;
  lastmod: string | null;
}

// Pull every <loc>…</loc> with its sibling <lastmod> from a <url> or
// <sitemap> block. Sitemaps are flat enough that a regex over <url|sitemap>
// blocks beats pulling in an XML parser (mirrors secFormD's pickTag approach).
function parseEntries(xml: string, tag: "url" | "sitemap"): SitemapUrl[] {
  const out: SitemapUrl[] = [];
  const blockRe = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(xml)) !== null) {
    const block = m[1] ?? "";
    const loc = /<loc\b[^>]*>([\s\S]*?)<\/loc>/i.exec(block)?.[1]?.trim();
    if (!loc) continue;
    const lastmod = /<lastmod\b[^>]*>([\s\S]*?)<\/lastmod>/i.exec(block)?.[1]?.trim() ?? null;
    out.push({ loc: decodeXmlEntities(loc), lastmod });
  }
  return out;
}

// Sitemaps XML-escape `&` in URLs as `&amp;`; decode the handful that occur.
function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parseLastmod(raw: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function readPrefixes(config: Record<string, unknown>): string[] {
  const raw = config.pathPrefix;
  if (typeof raw === "string" && raw.length > 0) return [raw];
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === "string" && x.length > 0);
  return [];
}

// True when `loc`'s path contains one of `prefixes` AND has a non-empty
// segment after it (so the listing page itself — e.g. exactly "/news/" — is
// excluded, only "/news/<slug>" articles pass). Empty prefixes = accept all.
function matchesPrefix(loc: string, prefixes: string[]): boolean {
  if (prefixes.length === 0) return true;
  let pathname: string;
  try {
    pathname = new URL(loc).pathname;
  } catch {
    pathname = loc;
  }
  return prefixes.some((p) => {
    const idx = pathname.indexOf(p);
    if (idx === -1) return false;
    const after = pathname.slice(idx + p.length).replace(/\/+$/, "");
    return after.length > 0;
  });
}

// Last non-empty path segment → spaced, first-letter-capitalized words.
// Preserves existing case per token so slug acronyms survive
// ("AI-enabled-cyber" → "AI Enabled Cyber", "acquires-vercept" →
// "Acquires Vercept").
export function titleFromSlug(loc: string): string {
  let pathname: string;
  try {
    pathname = new URL(loc).pathname;
  } catch {
    pathname = loc;
  }
  const seg = pathname.replace(/\/+$/, "").split("/").filter(Boolean).pop() ?? "";
  const words = seg
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  return words.join(" ");
}

// Fetch the og:title meta tag from the first OG_TITLE_SCAN_BYTES of an article
// page. Falls back to null on any fetch error, missing tag, or blank value.
// Both attribute orderings of <meta property="og:title" content="..."> are matched.
async function fetchOgTitleFromPage(url: string, ua: string): Promise<string | null> {
  try {
    const res = await requestOnce(url, ua);
    const reader = res.body?.getReader();
    if (!reader) return null;
    const decoder = new TextDecoder();
    let text = "";
    let totalBytes = 0;
    try {
      while (totalBytes < OG_TITLE_SCAN_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        totalBytes += value.length;
      }
    } finally {
      reader.cancel().catch(() => {});
    }
    const match =
      /<meta\s[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i.exec(text) ??
      /<meta\s[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i.exec(text);
    const title = match?.[1]?.trim() ?? null;
    return title && title.length > 0 ? title : null;
  } catch {
    return null;
  }
}

function buildCandidate(entry: SitemapUrl, publishedAt: Date): Candidate {
  let url = entry.loc;
  try {
    url = canonicalizeUrl(entry.loc);
  } catch {
    url = entry.loc;
  }
  const title = titleFromSlug(entry.loc);
  return {
    externalId: url,
    url,
    title: title.length > 0 ? title : null,
    summary: null,
    publishedAt,
    contentHash: sha256Truncated(`${url}\n${title}`),
    rawPayload: {
      source: "sitemap",
      loc: entry.loc,
      lastmod: entry.lastmod,
      derivedTitle: title,
    },
  };
}

export async function sitemapAdapter(ctx: AdapterContext): Promise<AdapterResult> {
  if (!ctx.endpoint) throw new Error("network");

  const cfg = ctx.config ?? {};
  const ua = pickUserAgent(cfg);
  const prefixes = readPrefixes(cfg);
  const lookbackDays =
    typeof cfg.lookbackDays === "number" ? cfg.lookbackDays : DEFAULT_LOOKBACK_DAYS;
  const maxUrls = typeof cfg.maxUrls === "number" ? cfg.maxUrls : DEFAULT_MAX_URLS;
  const sitemapFilter =
    typeof cfg.sitemapFilter === "string" ? cfg.sitemapFilter : null;
  const fetchOgTitleEnabled = cfg.fetchOgTitle === true;

  const rootXml = await fetchText(ctx.endpoint, ua);

  // Content sniff (not a header gate): a sitemap must self-identify as a
  // urlset or a sitemapindex. This is more robust than a content-type check
  // across the many ways sitemaps are served, and still rejects an HTML
  // error / landing page (the openrss.org failure mode).
  const isIndex = /<sitemapindex\b/i.test(rootXml);
  const isUrlset = /<urlset\b/i.test(rootXml);
  if (!isIndex && !isUrlset) throw new Error("wrong_content_type");

  // Collect <url> entries — directly for a urlset, or by following the
  // sub-sitemaps of an index (filtered + bounded).
  let entries: SitemapUrl[];
  if (isIndex) {
    let subs = parseEntries(rootXml, "sitemap");
    if (sitemapFilter) subs = subs.filter((s) => s.loc.includes(sitemapFilter));
    subs = subs.slice(0, MAX_SUBSITEMAPS);
    entries = [];
    for (let i = 0; i < subs.length; i++) {
      if (i > 0) await sleep(INTER_REQUEST_DELAY_MS);
      try {
        const subXml = await fetchText(subs[i]!.loc, ua);
        entries.push(...parseEntries(subXml, "url"));
      } catch (err) {
        // One sub-sitemap failing must not abort the whole poll.
        // eslint-disable-next-line no-console
        console.error(
          `[sitemap-adapter] sub-sitemap ${subs[i]!.loc} failed:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  } else {
    entries = parseEntries(rootXml, "url");
  }

  const now = Date.now();
  const cutoffMs = lookbackDays * 24 * 60 * 60 * 1000;

  const candidates: Candidate[] = [];
  for (const entry of entries) {
    if (!matchesPrefix(entry.loc, prefixes)) continue;
    // lastmod is required: without it we can neither apply recency nor give
    // the candidate a publishedAt (the heuristic seam rejects null-dated
    // candidates as recency_too_old, so emitting them is pure waste).
    const lastmod = parseLastmod(entry.lastmod);
    if (!lastmod) continue;
    if (now - lastmod.getTime() > cutoffMs) continue;
    candidates.push(buildCandidate(entry, lastmod));
  }

  // Newest first, then cap — so a backlog never blows past the per-poll bound.
  candidates.sort(
    (a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0),
  );
  const final = candidates.length > maxUrls ? candidates.slice(0, maxUrls) : candidates;
  if (candidates.length > maxUrls) {
    // eslint-disable-next-line no-console
    console.log(
      `[sitemap-adapter] capped at maxUrls=${maxUrls} (matched ${candidates.length} in window) — raise config.maxUrls to widen`,
    );
  }

  // og:title upgrade — replace slug-derived titles with real page headlines.
  // Runs only when config.fetchOgTitle is true; any per-URL fetch error falls
  // back silently to the slug-derived title already on the candidate.
  if (fetchOgTitleEnabled) {
    for (let i = 0; i < final.length; i++) {
      if (i > 0) await sleep(INTER_REQUEST_DELAY_MS);
      const ogTitle = await fetchOgTitleFromPage(final[i]!.url, ua);
      if (ogTitle) {
        final[i] = { ...final[i]!, title: ogTitle };
      }
    }
  }

  return { candidates: final };
}
