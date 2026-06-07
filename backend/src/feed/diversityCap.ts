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
// bottom. A source that fills 2 of positions 1–20 can appear again at
// position 21+, just not clustered.
//
// Why this runs on the FULL pool before `slice(offset, offset+limit)`:
// the feed paginates with offset/limit, but the window is 20 — it spans
// multiple pages. Capping per-page-slice would let a source put 2 events
// at the bottom of page 1 and 2 more at the top of page 2 (4 in one
// 20-window). Reordering the whole ranked pool once, then slicing, keeps
// pagination stable and the invariant intact.
//
// Native posts (events.source_type === 'native', SIGNAL-authored
// editorial) are exempt: they are never capped and never count toward
// any source's window tally. There is only ever a handful of them and
// they carry no external source identity to cluster on.

/** Max events from one source within any DIVERSITY_WINDOW-position window. */
export const MAX_PER_SOURCE = 2;

/** Sliding-window size, in feed positions, the cap is measured over. */
export const DIVERSITY_WINDOW = 20;

/** events.source_type value flagging a SIGNAL-authored native post. */
export const NATIVE_SOURCE_TYPE = "native";

/**
 * Per-content-type spread (Batch 4, roadmap §20.5). Layered on top of the
 * per-source cap: within any CLASS_WINDOW-position window, a content CLASS may
 * not exceed its MAX_PER_CLASS quota. Only the dominant "news" class (plain
 * single-source ingested news → DISPATCH cards) is capped; scarce high-value
 * classes (native, filing, launch) stay uncapped so they surface freely. This
 * breaks up "DISPATCH-heavy" runs once non-news sources (GitHub, Product Hunt,
 * the real-time layer) supply enough items to interleave; until then the
 * best-effort fallback places news anyway, so the feed never starves. The
 * window is tighter than the source window so the spread is felt near the top.
 * Tune during the soak.
 */
export const CLASS_WINDOW = 8;
export const MAX_PER_CLASS: Readonly<Record<string, number>> = { news: 5 };

/** Minimal row shape the cap reasons over. */
export interface DiversityItem {
  primarySourceName: string | null;
  sourceType: string;
  /** events.content_type — drives the per-class spread. Absent → "news". */
  contentType?: string | null;
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
  // Coarse content class for the per-type spread. Natives + the scarce
  // content_type families are uncapped; everything else is plain "news".
  const classOf = (item: T): string => {
    if (isNative(item)) return "native";
    if (item.contentType === "filing") return "filing";
    if (item.contentType === "launch") return "launch";
    return "news";
  };

  // Source cap: no source > maxPerSource in the trailing source window.
  // Natives carry no external source identity, so they always fit.
  const fitsSource = (item: T): boolean => {
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

  // Class cap: a capped class (only "news" today) may not exceed its quota
  // in the trailing CLASS_WINDOW. Uncapped classes always fit.
  const fitsClass = (item: T): boolean => {
    const cls = classOf(item);
    const cap = MAX_PER_CLASS[cls];
    if (cap === undefined) return true;
    const windowStart = Math.max(0, result.length - (CLASS_WINDOW - 1));
    let count = 0;
    for (let i = windowStart; i < result.length; i++) {
      if (classOf(result[i]!) === cls) count++;
    }
    return count < cap;
  };

  // Placeable when it breaches neither the source nor the class window.
  const fitsWindow = (item: T): boolean => fitsSource(item) && fitsClass(item);

  while (remaining.length > 0) {
    // Prefer an item that fits BOTH the source and class windows.
    let pickIndex = remaining.findIndex((item) => fitsWindow(item));
    // Fall back to one that fits the SOURCE window — the per-class spread is
    // best-effort and must never break the (tested) source invariant. This is
    // what keeps an all-"news" pool spreading by source even though the class
    // cap can't be satisfied.
    if (pickIndex === -1) pickIndex = remaining.findIndex((item) => fitsSource(item));
    // True degenerate (e.g. an all-one-source pool): place the highest-ranked
    // remaining item rather than drop it or loop forever.
    if (pickIndex === -1) pickIndex = 0;
    const [picked] = remaining.splice(pickIndex, 1);
    result.push(picked);
  }

  return result;
}
