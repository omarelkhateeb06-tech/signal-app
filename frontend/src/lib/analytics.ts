import { useAuthStore } from "@/store/authStore";

// Phase 12w — product-analytics seam. Fires named funnel events so the
// offer is falsifiable (upgrade views, checkout starts, signup funnel,
// plan choice). Events land in product_events via POST /api/v1/events
// (optional-auth): when the reader is signed in we attach their JWT so the
// event is attributed to them; otherwise it lands anonymously so the
// pre-signup funnel is still counted.
//
// Transport is best-effort and NEVER throws. Authed: keepalive fetch with the
// Bearer header (survives navigation AND carries auth, which sendBeacon can't).
// Anonymous: sendBeacon. Dev-console fallback when no API base is configured.
export type AnalyticsEvent =
  | "upgrade_viewed"
  | "checkout_started"
  | "signup_started"
  | "signup_completed"
  | "theme_toggled";

function currentToken(): string | null {
  try {
    return useAuthStore.getState().token;
  } catch {
    return null;
  }
}

export function track(
  event: AnalyticsEvent,
  props: Record<string, unknown> = {},
): void {
  if (typeof window === "undefined") return;
  const base = process.env.NEXT_PUBLIC_API_URL ?? "";
  const payload = {
    event,
    props,
    ts: Date.now(),
    path: window.location.pathname,
  };
  try {
    if (!base) {
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.debug("[analytics]", event, props);
      }
      return;
    }
    const url = `${base}/api/v1/events`;
    const body = JSON.stringify(payload);
    const token = currentToken();
    if (token) {
      // Authed path — keepalive fetch carries the Bearer header so the event
      // is attributed to the user and survives navigation/beforeunload.
      void fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body,
        keepalive: true,
      }).catch(() => undefined);
    } else if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      // Anonymous path — sendBeacon can't set headers, so the event lands
      // user-less (the pre-signup funnel is still counted).
      navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
    } else if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.debug("[analytics]", event, props);
    }
  } catch {
    // Analytics must never break a user flow — swallow everything.
  }
}
