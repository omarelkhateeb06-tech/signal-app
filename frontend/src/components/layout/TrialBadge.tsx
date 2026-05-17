"use client";

import Link from "next/link";
import { useTier } from "@/hooks/useTier";

// Phase 12j — trial-state chip in the top nav.
//
//   pro_trial      → "{N} days left on Pro" pill, accent tint by
//                    default; amber + breathe animation when ≤1 day.
//   free           → subtle "Upgrade to Pro" text link (not a banner).
//   pro / loading  → nothing rendered.
//
// "loading" returns null so the chrome doesn't flash a partial state
// during the initial useTier fetch.

export function TrialBadge(): JSX.Element | null {
  const tierQuery = useTier();
  const data = tierQuery.data;
  if (!data) return null;
  if (data.tier === "pro") return null;

  if (data.tier === "pro_trial") {
    const days = data.trial_days_remaining ?? 0;
    const urgent = days <= 1;
    const baseClasses =
      "inline-flex items-center rounded-pill px-2.5 py-1 text-xs font-medium transition-colors";
    const toneClasses = urgent
      ? "border border-warn/40 bg-warn/10 text-warn animate-breathe"
      : "border border-accent/30 text-accent";
    return (
      <Link
        href="/upgrade"
        data-testid="trial-badge"
        className={`${baseClasses} ${toneClasses}`}
        style={
          urgent
            ? undefined
            : { backgroundColor: "color-mix(in srgb, var(--accent) 10%, transparent)" }
        }
      >
        {days} day{days === 1 ? "" : "s"} left on Pro
      </Link>
    );
  }

  // tier === "free"
  return (
    <Link
      href="/upgrade"
      data-testid="free-upgrade-link"
      className="text-sm font-medium text-accent hover:underline"
    >
      Upgrade to Pro
    </Link>
  );
}
