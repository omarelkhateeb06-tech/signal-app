import Link from "next/link";
import { ArrowLeft } from "lucide-react";

// Phase 12h — Stripe redirects here when the user cancels the checkout flow.
export default function BillingCancelPage(): JSX.Element {
  return (
    <div className="mx-auto max-w-[480px] space-y-8 py-16 text-center">
      <div className="space-y-3">
        <h1 className="font-display text-[32px] font-bold leading-tight tracking-tight text-ink">
          No charge made.
        </h1>
        <p className="text-base leading-relaxed text-ink-muted">
          You haven&apos;t been charged. Your account stays exactly as it was.
        </p>
        <p className="text-sm text-ink-muted">
          Ready when you are — upgrade takes less than a minute.
        </p>
      </div>

      <div className="flex flex-col items-center gap-3">
        <Link
          href="/upgrade"
          className="inline-flex h-11 items-center justify-center rounded-md bg-accent px-6 text-sm font-semibold text-accent-fg transition-colors hover:opacity-90 hover:no-underline"
        >
          Back to upgrade
        </Link>
        <Link
          href="/feed"
          className="inline-flex items-center gap-1.5 text-sm text-ink-muted transition-colors hover:text-ink hover:no-underline"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to the briefing
        </Link>
      </div>
    </div>
  );
}
