// Phase 12w — product-analytics seam. Fires named funnel events so the
// offer is falsifiable (upgrade views, checkout starts, plan choice).
// Transport is best-effort and NEVER throws: sendBeacon to the events
// endpoint when available, dev-console fallback otherwise. When a real
// analytics backend lands, swap the transport here — call sites don't
// change.
export type AnalyticsEvent =
  | "upgrade_viewed"
  | "checkout_started"
  | "theme_toggled";

export function track(
  event: AnalyticsEvent,
  props: Record<string, unknown> = {},
): void {
  if (typeof window === "undefined") return;
  const payload = {
    event,
    props,
    ts: Date.now(),
    path: window.location.pathname,
  };
  try {
    const base = process.env.NEXT_PUBLIC_API_URL ?? "";
    const body = JSON.stringify(payload);
    if (base && typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon(
        `${base}/api/v1/events`,
        new Blob([body], { type: "application/json" }),
      );
    } else if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.debug("[analytics]", event, props);
    }
  } catch {
    // Analytics must never break a user flow — swallow everything.
  }
}
