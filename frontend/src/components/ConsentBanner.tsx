"use client";

import { useConsent } from "@/hooks/useConsent";

// GDPR cookie-consent banner. Shows once, on first visit, until the reader
// chooses. "Accept all" opts into analytics (hasAnalyticsConsent → true);
// "Essential only" keeps just the auth JWT. Fixed to the bottom across every
// page. (A link to the privacy policy should be added here once that page
// exists — it's a pending pre-launch item.)
export function ConsentBanner(): JSX.Element | null {
  const { decided, accept, reject } = useConsent();
  if (decided) return null;

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      className="fixed inset-x-0 bottom-0 z-[60] border-t border-line bg-surface/95 px-4 py-3 backdrop-blur md:px-8"
    >
      <div className="mx-auto flex max-w-[1100px] flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[13px] leading-relaxed text-ink-muted">
          SIGNAL uses essential cookies to keep you signed in, and — with your
          consent — analytics cookies to understand how the product is used.
        </p>
        <div className="flex flex-none items-center gap-2">
          <button
            type="button"
            onClick={reject}
            className="border border-line px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted transition-colors hover:border-ink-muted hover:text-ink"
          >
            Essential only
          </button>
          <button
            type="button"
            onClick={accept}
            className="bg-accent px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-bg transition-colors hover:bg-accent-hover"
          >
            Accept all
          </button>
        </div>
      </div>
    </div>
  );
}
