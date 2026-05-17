"use client";

import Link from "next/link";
import type { GateUpgradeCta } from "@/types/story";

// Phase 12g — shared upgrade button. Renders as a link to /upgrade
// with copy that branches on whether the user still has a trial
// available. Used by GatedStoryCard, the depth inline prompt, and
// the search modal.
export function UpgradeCtaButton({
  cta,
  className,
}: {
  cta: GateUpgradeCta;
  className?: string;
}): JSX.Element {
  const label = cta.trial_available ? "Start Free Trial" : "Upgrade to Pro";
  return (
    <Link
      href="/upgrade"
      className={
        className ??
        "inline-flex h-9 items-center justify-center rounded-md bg-violet-700 px-4 text-sm font-medium text-white hover:bg-violet-800"
      }
    >
      {label}
    </Link>
  );
}
