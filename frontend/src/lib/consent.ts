// Cookie / analytics consent (GDPR). Essential cookies (the auth JWT) always
// apply and need no consent; analytics is opt-in. The choice is persisted in
// localStorage and broadcast via a window event so the banner and any future
// analytics gate react without a reload. SSR-safe: every access guards
// `window` and swallows storage errors (private mode / blocked storage).

export type ConsentChoice = "accepted" | "rejected";

const STORAGE_KEY = "signal_consent_v1";
export const CONSENT_EVENT = "signal:consent-change";

export function getConsent(): ConsentChoice | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === "accepted" || v === "rejected" ? v : null;
  } catch {
    return null;
  }
}

export function setConsent(choice: ConsentChoice): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, choice);
    window.dispatchEvent(new CustomEvent(CONSENT_EVENT));
  } catch {
    /* storage blocked — no-op */
  }
}

// The gate any future analytics load MUST check: analytics runs only after an
// explicit "accept". No choice yet, or "rejected" → false.
export function hasAnalyticsConsent(): boolean {
  return getConsent() === "accepted";
}
