// Heuristic stage logic for the ingestion pipeline (Phase 12e.3).
//
// Pure module — no I/O, no DB. Exports constants, regex pattern arrays,
// the rejection-reason vocabulary, and the per-check pure functions
// consumed by `heuristicSeam.ts` and the orchestration body in
// `enrichmentJob.ts`.
//
// === HEURISTIC_REASONS vocabulary ===
//
// Pre-fetch (cheap) checks:
//   summary_and_title_empty — both raw_summary and raw_title null/blank.
//   recency_too_old        — raw_published_at older than 36h or null.
//   noise_linkbait         — title or summary matches LINKBAIT_PATTERNS.
//   noise_listicle         — title or summary matches LISTICLE_PATTERNS.
//   noise_paid             — title or summary matches PAID_CONTENT_PATTERNS.
//
// Body fetch failures (mirrored from the 12e.2 adapter taxonomy, prefixed
// to disambiguate body-fetch failures from feed-fetch failures in queries):
//   body_timeout           — AbortController fired before the body fetch.
//   body_4xx               — origin returned 4xx.
//   body_5xx               — origin returned 5xx.
//   body_wrong_content_type — Content-Type header isn't text/html.
//   body_parse_error       — readability returned null or threw.
//   body_network           — DNS / TLS / socket-level error.
//   body_fetch_failed      — umbrella for any unmatched fetch failure.
//
// Post-fetch check:
//   body_too_short         — extracted text below the 500-char floor.
//
// Informational only (NOT a rejection — pairs with status='heuristic_passed'):
//   body_truncated         — extracted text exceeded the 200 KB cap and
//                            was truncated; candidate still advances.

export const RECENCY_CUTOFF_HOURS = 36;
export const BODY_LENGTH_FLOOR_CHARS = 500;
export const BODY_SIZE_CAP_BYTES = 200_000;

// 12e.8 soak refines
export const LINKBAIT_PATTERNS: RegExp[] = [
  /^(you won't believe|this one (weird )?trick|shocking|jaw-?dropping)/i,
  /\b(\d+ (things|ways|reasons))\b/i,
];

// 12e.8 soak refines
export const LISTICLE_PATTERNS: RegExp[] = [
  /^(top|the )?\d+\s+(things|ways|reasons|tips|tricks|hacks|secrets)/i,
  /^(every|all the)\s+\w+\s+\w+\s+(ranked|rated)/i,
];

// 12e.8 soak refines
export const PAID_CONTENT_PATTERNS: RegExp[] = [
  /\b(sponsored content|advertisement|paid post|partner content|in partnership with)\b/i,
  /\bsponsored by\b/i,
];

export const HEURISTIC_REASONS = {
  SUMMARY_AND_TITLE_EMPTY: "summary_and_title_empty",
  RECENCY_TOO_OLD: "recency_too_old",
  NOISE_LINKBAIT: "noise_linkbait",
  NOISE_LISTICLE: "noise_listicle",
  NOISE_PAID: "noise_paid",
  BODY_FETCH_FAILED: "body_fetch_failed",
  BODY_TIMEOUT: "body_timeout",
  BODY_4XX: "body_4xx",
  BODY_5XX: "body_5xx",
  BODY_WRONG_CONTENT_TYPE: "body_wrong_content_type",
  BODY_PARSE_ERROR: "body_parse_error",
  BODY_NETWORK: "body_network",
  BODY_TOO_SHORT: "body_too_short",
  BODY_TRUNCATED: "body_truncated",
} as const;
export type HeuristicReason = (typeof HEURISTIC_REASONS)[keyof typeof HEURISTIC_REASONS];

export type NoiseCategory = "linkbait" | "listicle" | "paid";

// `null` publishedAt is treated as not-recent (rejected). 36h cutoff is
// inclusive of the boundary — exact 36h-old items still pass.
export function isRecent(publishedAt: Date | null, now: Date = new Date()): boolean {
  if (!publishedAt) return false;
  const ageMs = now.getTime() - publishedAt.getTime();
  if (ageMs < 0) return true; // future-dated items are "recent"
  return ageMs <= RECENCY_CUTOFF_HOURS * 60 * 60 * 1000;
}

export function isSummaryAndTitleEmpty(
  title: string | null,
  summary: string | null,
): boolean {
  const titleEmpty = title === null || title.trim().length === 0;
  const summaryEmpty = summary === null || summary.trim().length === 0;
  return titleEmpty && summaryEmpty;
}

export function meetsLengthFloor(text: string): boolean {
  return text.length >= BODY_LENGTH_FLOOR_CHARS;
}

// Returns the first noise match found across title + summary, scanning
// linkbait → listicle → paid in that order (deterministic for tests).
// `match: false` means none of the patterns hit.
export function matchesNoisePattern(
  title: string | null,
  summary: string | null,
): { match: boolean; category?: NoiseCategory } {
  const haystacks = [title ?? "", summary ?? ""].filter((s) => s.length > 0);
  if (haystacks.length === 0) return { match: false };

  for (const h of haystacks) {
    for (const re of LINKBAIT_PATTERNS) if (re.test(h)) return { match: true, category: "linkbait" };
  }
  for (const h of haystacks) {
    for (const re of LISTICLE_PATTERNS) if (re.test(h)) return { match: true, category: "listicle" };
  }
  for (const h of haystacks) {
    for (const re of PAID_CONTENT_PATTERNS) if (re.test(h)) return { match: true, category: "paid" };
  }
  return { match: false };
}

export function noiseCategoryToReason(cat: NoiseCategory): HeuristicReason {
  switch (cat) {
    case "linkbait":
      return HEURISTIC_REASONS.NOISE_LINKBAIT;
    case "listicle":
      return HEURISTIC_REASONS.NOISE_LISTICLE;
    case "paid":
      return HEURISTIC_REASONS.NOISE_PAID;
  }
}
