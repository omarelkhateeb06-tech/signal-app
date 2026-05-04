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

import { JSDOM } from "jsdom";
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
  | { success: true; text: string; truncated: boolean }
  | { success: false; reason: HeuristicReason };

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

  // Parse with jsdom and run readability.
  let textContent: string;
  try {
    const dom = new JSDOM(html, { url });
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
    };
  }
  return { success: true, text: textContent, truncated: false };
}
