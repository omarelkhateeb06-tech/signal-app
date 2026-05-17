"use client";

import Link from "next/link";
import { useTier } from "@/hooks/useTier";

// Phase 12g — header chip for the trial / free-tier status.
//
//   pro_trial → "Pro Trial — X days left". Visually urgent (amber)
//               when ≤1 day remains, neutral otherwise.
//   free      → "Free Plan" with an inline "Upgrade" link.
//   pro       → no chip rendered.
//   loading   → no chip rendered (chrome shouldn't flash a partial
//               state on every page load).
export function TrialBadge(): JSX.Element | null {
  const tierQuery = useTier();
  const data = tierQuery.data;
  if (!data) return null;

  if (data.tier === "pro") return null;

  if (data.tier === "pro_trial") {
    const days = data.trial_days_remaining ?? 0;
    const urgent = days <= 1;
    return (
      <Link
        href="/upgrade"
        data-testid="trial-badge"
        className={
          "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium " +
          (urgent
            ? "border-amber-300 bg-amber-50 text-amber-900"
            : "border-violet-200 bg-violet-50 text-violet-900")
        }
      >
        Pro Trial — {days} day{days === 1 ? "" : "s"} left
      </Link>
    );
  }

  // tier === "free"
  return (
    <span
      data-testid="free-plan-badge"
      className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-xs text-slate-600"
    >
      Free Plan
      <Link href="/upgrade" className="font-medium text-violet-700 hover:underline">
        Upgrade
      </Link>
    </span>
  );
}
