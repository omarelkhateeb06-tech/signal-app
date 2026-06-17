// Phase 12w — first-touch signup attribution.
//
// On the first page load of a session we capture where the visitor came from
// (utm_* query params + external referrer + landing path) and lock it in
// localStorage. The signup page reads it back and sends it with the signup
// request so the account records its acquisition channel. First-touch (never
// overwritten) because the channel that *brought* someone is the one worth
// crediting — a later in-app navigation shouldn't rewrite it.
//
// Best-effort and SSR-safe: every path swallows errors (private mode disables
// localStorage) and no-ops without a window.

const STORAGE_KEY = "signal_attribution";

export interface AttributionData {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  referrer?: string;
  landing_path?: string;
}

/**
 * Capture first-touch attribution into localStorage. No-op if already
 * captured (first-touch wins) or if localStorage is unavailable.
 */
export function captureAttribution(): void {
  if (typeof window === "undefined") return;
  try {
    if (window.localStorage.getItem(STORAGE_KEY)) return; // first-touch locked

    const params = new URLSearchParams(window.location.search);
    const data: AttributionData = {};

    const source = params.get("utm_source");
    const medium = params.get("utm_medium");
    const campaign = params.get("utm_campaign");
    if (source) data.utm_source = source.slice(0, 128);
    if (medium) data.utm_medium = medium.slice(0, 128);
    if (campaign) data.utm_campaign = campaign.slice(0, 128);

    // External referrer only — a same-origin referrer is an internal nav, not
    // an acquisition source.
    const ref = document.referrer;
    if (ref) {
      try {
        if (new URL(ref).host !== window.location.host) {
          data.referrer = ref.slice(0, 512);
        }
      } catch {
        // Malformed referrer — ignore.
      }
    }

    data.landing_path = window.location.pathname.slice(0, 512);

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // localStorage disabled / private mode — skip silently.
  }
}

/** Read the stored first-touch attribution, or null if none/unavailable. */
export function getAttribution(): AttributionData | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as AttributionData) : null;
  } catch {
    return null;
  }
}
