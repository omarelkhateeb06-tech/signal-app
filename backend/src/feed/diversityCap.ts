// Phase 12 — post-ranking source-diversity cap for the feed.
//
// Pure, side-effect-free reordering pass applied to the already-ranked
// event pool (by effective_score DESC) BEFORE pagination slicing. The
// invariant it enforces: no single source occupies more than
// MAX_PER_SOURCE slots within any window of DIVERSITY_WINDOW consecutive
// feed positions. Displaced slots are backfilled greedily with the
// next-ranked event from a source that still has room in the window.
//
// Why a sliding window rather than a global per-source cap: the goal is
// to break up visible "runs" of one outlet near the top of the feed
// without permanently demoting a prolific-but-high-quality source to the
// bottom. A source that fills 3 of positions 1–20 can appear again at
// position 21+, just not clustered.
//
// Why this runs on the FULL pool before `slice(offset, offset+limit)`:
// the feed paginates with offset/limit (default page size 10), but the
// window is 20 — it spans two pages. Capping per-page-slice would let a
// source put 3 events at the bottom of page 1 and 3 more at the top of
// page 2 (6 in one 20-window). Reordering the whole ranked pool once,
// then slicing, keeps pagination stable and the invariant intact.
//
// Native posts (events.source_type === 'native', SIGNAL-authored
// editorial) are exempt: they are never capped and never count toward
// any source's window tally. There is only ever a handful of them and
// they carry no external source identity to cluster on.

/** Max events from one source within any DIVERSITY_WINDOW-position window. */
export const MAX_PER_SOURCE = 3;

/** Sliding-window size, in feed positions, the cap is measured over. */
export const DIVERSITY_WINDOW = 20;

/** events.source_type value flagging a SIGNAL-authored native post. */
export const NATIVE_SOURCE_TYPE = "native";

/** Minimal row shape the cap reasons over. */
export interface DiversityItem {
  primarySourceName: string | null;
  sourceType: string;
}

/**
 * Reorder `ranked` (highest-priority first) so that within every window
 * of `windowSize` consecutive output positions, no single source appears
 * more than `maxPerSource` times. Native posts are exempt. Stable for
 * non-conflicting input: an item is only moved later when placing it
 * would breach the window cap, and it is then backfilled with the
 * highest-ranked eligible item.
 *
 * The pass never drops items. In the degenerate case where every
 * remaining item belongs to a source already at cap in the trailing
 * window, the highest-ranked remaining item is placed anyway — the cap
 * is a best-effort spread, not a hard filter that could shrink the feed.
 */
export function applyDiversityCap<T extends DiversityItem>(
  ranked: readonly T[],
  maxPerSource: number = MAX_PER_SOURCE,
  windowSize: number = DIVERSITY_WINDOW,
): T[] {
  const result: T[] = [];
  const remaining: T[] = [...ranked];

  const isNative = (item: T): boolean => item.sourceType === NATIVE_SOURCE_TYPE;
  const sourceKey = (item: T): string => item.primarySourceName ?? "(unknown)";

  // Can `item` be placed at the next position without breaching the
  // window cap? Natives always can. For others, count same-source
  // (non-native) items already placed in the trailing window-1 slots;
  // placing is allowed while that count is below the cap.
  const fitsWindow = (item: T): boolean => {
    if (isNative(item)) return true;
    const key = sourceKey(item);
    const windowStart = Math.max(0, result.length - (windowSize - 1));
    let count = 0;
    for (let i = windowStart; i < result.length; i++) {
      const placed = result[i];
      if (!isNative(placed) && sourceKey(placed) === key) count++;
    }
    return count < maxPerSource;
  };

  while (remaining.length > 0) {
    let pickIndex = remaining.findIndex((item) => fitsWindow(item));
    // Degenerate fallback: nothing fits the window. Place the
    // highest-ranked remaining item rather than drop it or loop forever.
    if (pickIndex === -1) pickIndex = 0;
    const [picked] = remaining.splice(pickIndex, 1);
    result.push(picked);
  }

  return result;
}
