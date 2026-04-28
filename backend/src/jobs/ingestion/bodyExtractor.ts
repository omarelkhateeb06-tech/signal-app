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
