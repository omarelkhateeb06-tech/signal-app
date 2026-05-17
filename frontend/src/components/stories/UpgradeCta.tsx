"use client";

import Link from "next/link";
import type { GateUpgradeCta } from "@/types/story";

// Phase 12j — upgrade CTA. Renders as a Link styled like the primary
// Button (Link can't compose Button directly without forwardRef
// gymnastics, so the styles are duplicated here from Button.tsx —
// kept in lockstep with the primary variant).
export function UpgradeCtaButton({
  cta,
  className,
  size = "md",
}: {
  cta: GateUpgradeCta;
  className?: string;
  size?: "sm" | "md" | "lg";
}): JSX.Element {
  const label = cta.trial_available ? "Start Free Trial" : "Upgrade to Pro";
  const sizeClass =
    size === "sm"
      ? "h-8 px-3 text-sm"
      : size === "lg"
        ? "h-12 px-6 text-base"
        : "h-10 px-4 text-sm";
  const cls = [
    "inline-flex items-center justify-center gap-2 rounded-md font-medium",
    "bg-accent text-accent-fg hover:bg-accent-hover",
    "transition-all duration-150 ease-soft-out",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
    sizeClass,
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <Link href="/upgrade" className={cls}>
      {label}
    </Link>
  );
}
