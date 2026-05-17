// Body fetch + readability extraction for the heuristic stage.
//
// Mirrors the fetch / failure-class logic from rss.ts, except:
//   - Accept content-type `text/html` (and only that — feeds are
//     already rejected upstream by the adapter).
//   - On 2xx + good content-type, parse with jsdom + @mozilla/readability
//     and return the cleaned plain text.
//   - Truncate at the 200 KB cap rather than rejecting; truncation is
//     informational, not a failure.
//
// User-Agent: caller provides. Falls back to a per-stage default if
// the source's config.userAgent is unset upstream.

import { JSDOM, VirtualConsole } from "jsdom";
import { Readability } from "@mozilla/readability";

import { BODY_SIZE_CAP_BYTES, HEURISTIC_REASONS, type HeuristicReason } from "./heuristics";

export const DEFAULT_BODY_USER_AGENT = "SIGNAL/12e.3 (+contact@signal.so)";
export const DEFAULT_BODY_TIMEOUT_MS = 15_000;

// 12e.x: paywall detection. Most paywalled CNBC URLs serve HTML that
// readability "succeeds" on but ends up with extracted text consisting
// of subscribe-prompts and nav chrome — fact extraction then trips on
// missing article body and surfaces as facts_parse_error. Catching the
// paywall response at fetch time turns it into a clean
// `heuristic_filtered`/`filtered_paywall` rejection instead of a
// downstream stage failure. Indicators: distinctive markup classes
// CNBC uses for the paywall gate. Kept to high-precision strings so
// non-paywalled CNBC pages don't get caught by accident.
const PAYWALL_HOSTS = new Set(["cnbc.com", "www.cnbc.com"]);
const PAYWALL_HTML_INDICATORS: readonly string[] = [
  "ProPaywall-",
  "data-test=\"PaywallContent\"",
  "PaywallInline-",
  "id=\"paywall\"",
];

function hostMatchesPaywallSet(rawUrl: string): boolean {
  try {
    return PAYWALL_HOSTS.has(new URL(rawUrl).host.toLowerCase());
  } catch {
    return false;
  }
}

export function detectPaywall(rawUrl: string, html: string): boolean {
  if (!hostMatchesPaywallSet(rawUrl)) return false;
  return PAYWALL_HTML_INDICATORS.some((needle) => html.includes(needle));
}

export type BodyExtractionResult =
  | { success: true; text: string; truncated: boolean; imageUrl: string | null }
  | { success: false; reason: HeuristicReason };

// Phase 12k — extract the page's og:image (or twitter:image fallback)
// from the parsed HTML. Returns null when:
//   - neither meta tag is present
//   - the content attribute is missing / empty
//   - the URL is malformed
//   - the URL is not http(s) (e.g. data: URI, javascript:, file:, etc.)
//
// Resolved against `baseUrl` so relative `og:image` paths (rare but
// they happen) become absolute. Soft-fail discipline: any DOM parse
// problem returns null, never throws. The caller treats null as "no
// image" — not an error condition.
export function extractOgImage(
  document: Document,
  baseUrl: string,
): string | null {
  const candidates: ReadonlyArray<{ selector: string }> = [
    { selector: 'meta[property="og:image"]' },
    { selector: 'meta[property="og:image:url"]' },
    { selector: 'meta[name="twitter:image"]' },
    { selector: 'meta[name="twitter:image:src"]' },
  ];
  for (const { selector } of candidates) {
    const el = document.querySelector(selector);
    if (!el) continue;
    const raw = el.getAttribute("content");
    if (!raw) continue;
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    // Reject data: / javascript: / file: / mailto: outright before
    // attempting URL resolution — `new URL('data:...')` succeeds, so we
    // can't rely on the constructor alone to enforce http(s).
    const lower = trimmed.toLowerCase();
    if (
      lower.startsWith("data:") ||
      lower.startsWith("javascript:") ||
      lower.startsWith("file:") ||
      lower.startsWith("mailto:")
    ) {
      continue;
    }
    let resolved: URL;
    try {
      resolved = new URL(trimmed, baseUrl);
    } catch {
      continue;
    }
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
      continue;
    }
    return resolved.toString();
  }
  return null;
}

export interface FetchAndExtractOptions {
  userAgent: string;
  timeoutMs?: number;
}

function classifyFetchError(err: unknown): HeuristicReason {
  const e = err as { name?: string };
  if (e.name === "AbortError") return HEURISTIC_REASONS.BODY_TIMEOUT;
  return HEURISTIC_REASONS.BODY_NETWORK;
}

function isAcceptedContentType(header: string | null): boolean {
  if (!header) return false;
  const type = header.split(";")[0]?.trim().toLowerCase() ?? "";
  return type === "text/html";
}

export async function fetchAndExtractBody(
  url: string,
  options: FetchAndExtractOptions,
): Promise<BodyExtractionResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_BODY_TIMEOUT_MS;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let html: string;
  try {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          "User-Agent": options.userAgent,
          Accept: "text/html, */*;q=0.5",
        },
        signal: ctrl.signal,
      });
    } catch (err) {
      return { success: false, reason: classifyFetchError(err) };
    }

    if (res.status >= 400 && res.status < 500) {
      return { success: false, reason: HEURISTIC_REASONS.BODY_4XX };
    }
    if (res.status >= 500 && res.status < 600) {
      return { success: false, reason: HEURISTIC_REASONS.BODY_5XX };
    }
    if (res.status < 200 || res.status >= 300) {
      return { success: false, reason: HEURISTIC_REASONS.BODY_FETCH_FAILED };
    }

    if (!isAcceptedContentType(res.headers.get("content-type"))) {
      try {
        await res.text();
      } catch {
        /* ignore */
      }
      return { success: false, reason: HEURISTIC_REASONS.BODY_WRONG_CONTENT_TYPE };
    }

    html = await res.text();
  } finally {
    clearTimeout(timer);
  }

  // 12e.x: paywall detection runs before readability — if the host is
  // known to paywall and the body carries a paywall marker, surface
  // it as a `filtered_paywall` rejection rather than letting
  // readability succeed on subscribe chrome and downstream stages
  // trip on the missing article body.
  if (detectPaywall(url, html)) {
    return { success: false, reason: HEURISTIC_REASONS.FILTERED_PAYWALL };
  }

  // Parse with jsdom and run readability. The same parsed document also
  // feeds the og:image extractor — single DOM parse, two consumers.
  //
  // Silent VirtualConsole: by default jsdom forwards every CSS parse
  // warning, resource-load error, and script-runtime message from the
  // parsed page to Node's `console`. In the worker that's a stream of
  // junk into Railway logs (and into local-test stdout) on every
  // enrichment. A fresh VirtualConsole with no sendTo() drops it all;
  // bodyExtractor only consumes the DOM via querySelector + readability,
  // neither of which depends on those events.
  let textContent: string;
  let imageUrl: string | null = null;
  try {
    const virtualConsole = new VirtualConsole();
    const dom = new JSDOM(html, { url, virtualConsole });
    // Pull og:image first — readability's parse() can mutate document
    // structure (or, on some pages, throw). Doing meta-tag extraction
    // before readability isolates the cheap, reliable pass from the
    // expensive, occasionally-fragile one.
    imageUrl = extractOgImage(dom.window.document, url);
    const article = new Readability(dom.window.document).parse();
    if (!article || typeof article.textContent !== "string") {
      return { success: false, reason: HEURISTIC_REASONS.BODY_PARSE_ERROR };
    }
    textContent = article.textContent.trim();
  } catch {
    return { success: false, reason: HEURISTIC_REASONS.BODY_PARSE_ERROR };
  }

  if (textContent.length > BODY_SIZE_CAP_BYTES) {
    return {
      success: true,
      text: textContent.slice(0, BODY_SIZE_CAP_BYTES),
      truncated: true,
      imageUrl,
    };
  }
  return { success: true, text: textContent, truncated: false, imageUrl };
}
