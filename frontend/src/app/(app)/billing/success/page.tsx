import Link from "next/link";
import { CheckCircle2 } from "lucide-react";

// Phase 12h — Stripe redirects here after a successful checkout.
// The tier flip happens via webhook (checkout.session.completed), so
// the user may need to refresh the feed once to see Pro content.
export default function BillingSuccessPage(): JSX.Element {
  return (
    <div className="mx-auto max-w-[480px] space-y-8 py-16 text-center">
      <div className="flex justify-center">
        <CheckCircle2 className="h-14 w-14 text-accent" aria-hidden />
      </div>

      <div className="space-y-3">
        <h1 className="font-display text-[32px] font-bold leading-tight tracking-tight text-ink">
          You&apos;re on Pro.
        </h1>
        <p className="text-base leading-relaxed text-ink-muted">
          Your account has been upgraded. Personalized commentary, all three
          depths, and the daily digest are now live.
        </p>
        <p className="text-sm text-ink-muted">
          If the feed still shows the free view, refresh once — the upgrade
          lands via webhook and takes a few seconds.
        </p>
      </div>

      <div className="flex flex-col items-center gap-3">
        <Link
          href="/feed"
          className="inline-flex h-11 items-center justify-center rounded-md bg-accent px-6 text-sm font-semibold text-accent-fg transition-colors hover:opacity-90 hover:no-underline"
        >
          Back to the briefing
        </Link>
        <Link
          href="/settings"
          className="text-sm text-ink-muted transition-colors hover:text-ink hover:no-underline"
        >
          Manage billing in Settings
        </Link>
      </div>
    </div>
  );
}
