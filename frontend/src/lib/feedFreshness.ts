// Redesign v2 — freshness derivation (stickiness item 4: a reason to return).
//
// A daily-briefing product is only a habit if "what's new since I left" is
// legible at a glance. There is no dedicated freshness field on the wire, so
// we derive it from the timestamp already on every story. Pure and `now`-
// injected so it is deterministic under test (no Date.now() inside).

/** Stories published/created within this many hours read as "new". */
export const FRESH_WINDOW_HOURS = 18;

/**
 * True when `iso` is within `windowHours` before `nowMs`. Returns false for
 * null/invalid timestamps and for future timestamps beyond a small clock-skew
 * grace (5 min), so a bad row never flashes a spurious NEW badge.
 */
export function isRecent(
  iso: string | null | undefined,
  nowMs: number,
  windowHours: number = FRESH_WINDOW_HOURS,
): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  const ageMs = nowMs - t;
  const SKEW_GRACE_MS = 5 * 60 * 1000;
  if (ageMs < -SKEW_GRACE_MS) return false;
  return ageMs <= windowHours * 60 * 60 * 1000;
}

/** Prefer the published timestamp; fall back to created_at. */
export function freshnessTimestamp(story: {
  published_at: string | null;
  created_at: string;
}): string {
  return story.published_at ?? story.created_at;
}

/**
 * True when `iso` falls strictly after `boundaryMs`. The boundary is the
 * "since you last looked" cutoff — a story published after it is new to this
 * reader. Null / invalid timestamps are never fresh.
 */
export function isAfter(
  iso: string | null | undefined,
  boundaryMs: number,
): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  return t > boundaryMs;
}

/**
 * Resolve the freshness cutoff for the feed. A returning reader's previous
 * visit wins — "new since you were last here". With no recorded visit (first
 * session) we fall back to a rolling window so the first experience still
 * surfaces a sensible NEW set. Null `nowMs` (SSR / pre-mount) yields null —
 * no badges until the client clock is known.
 */
export function freshBoundaryMs(
  previousVisitMs: number | null,
  nowMs: number | null,
  windowHours: number = FRESH_WINDOW_HOURS,
): number | null {
  if (previousVisitMs != null) return previousVisitMs;
  if (nowMs == null) return null;
  return nowMs - windowHours * 60 * 60 * 1000;
}
