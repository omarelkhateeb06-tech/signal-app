import { postEngagementEventsRequest, type EngagementEventInput } from "./api";

// Phase 12o — client-side engagement telemetry buffer.
//
// Collects interaction events (story_view dwell, click_through, share) and
// flushes them to /api/v1/engagement/events in batches: on a size threshold,
// on a debounce timer, and when the tab is hidden (visibilitychange). Every
// send is best-effort — failures are swallowed so telemetry never disrupts the
// reading experience. SSR-safe: track() is a no-op without a window, and the
// visibility listener is attached lazily on first use.
//
// Distinct from lib/analytics.ts: that seam fires *anonymous* product-funnel
// events (upgrade_viewed, checkout_started) via sendBeacon. This is the
// *authed, per-user* behavioural signal (story_view dwell, click_through,
// share) that feeds Ranking v2 — batched to the JWT-auth engagement endpoint.

const FLUSH_THRESHOLD = 12; // flush once the queue reaches this many events
const FLUSH_DEBOUNCE_MS = 8000;

let queue: EngagementEventInput[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let listenerAttached = false;

function flush(): void {
  if (queue.length === 0) return;
  const batch = queue;
  queue = [];
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  // Fire-and-forget; swallow errors — telemetry must never surface to the user.
  void postEngagementEventsRequest(batch).catch(() => {});
}

function ensureListener(): void {
  if (listenerAttached || typeof document === "undefined") return;
  listenerAttached = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
}

/** Queue one engagement event. No-op during SSR. */
export function trackEngagement(event: EngagementEventInput): void {
  if (typeof window === "undefined") return;
  ensureListener();
  queue.push({
    ...event,
    occurred_at: event.occurred_at ?? new Date().toISOString(),
  });
  if (queue.length >= FLUSH_THRESHOLD) {
    flush();
    return;
  }
  if (!timer) {
    timer = setTimeout(flush, FLUSH_DEBOUNCE_MS);
  }
}

/** Force-drain the queue (e.g. on a view-ending transition). */
export function flushEngagement(): void {
  flush();
}

/** Current queued count — test/diagnostic only. */
export function pendingEngagementCount(): number {
  return queue.length;
}

/** Reset module state — test only. */
export function __resetEngagementForTests(): void {
  queue = [];
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  listenerAttached = false;
}
