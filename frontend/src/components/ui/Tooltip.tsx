"use client";

import { useId, useState, type ReactNode } from "react";

// Phase 12j — Tooltip primitive. CSS-positioned, hover/focus
// activated, lightweight. Not a fully featured popover — for short
// label-style hints (SIGNAL rating explanation, depth-tier hover
// hints). Multi-paragraph content should use Modal instead.

export interface TooltipProps {
  label: ReactNode;
  children: ReactNode;
  // Tooltip placement relative to the trigger. The 12j surfaces all
  // use top + bottom; left/right are kept for completeness.
  side?: "top" | "bottom" | "left" | "right";
}

const SIDE_CLASSES: Record<NonNullable<TooltipProps["side"]>, string> = {
  top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
  bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
  left: "right-full top-1/2 -translate-y-1/2 mr-2",
  right: "left-full top-1/2 -translate-y-1/2 ml-2",
};

export function Tooltip({
  label,
  children,
  side = "top",
}: TooltipProps): JSX.Element {
  const [visible, setVisible] = useState(false);
  const id = useId();

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      <span aria-describedby={visible ? id : undefined}>{children}</span>
      {visible && (
        <span
          role="tooltip"
          id={id}
          className={[
            "pointer-events-none absolute z-50 whitespace-nowrap rounded-md",
            "bg-ink px-2 py-1 text-xs font-medium text-bg shadow-card",
            "animate-fade-up",
            SIDE_CLASSES[side],
          ].join(" ")}
        >
          {label}
        </span>
      )}
    </span>
  );
}
