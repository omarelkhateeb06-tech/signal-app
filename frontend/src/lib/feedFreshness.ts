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
