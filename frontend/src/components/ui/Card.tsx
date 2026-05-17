"use client";

import { forwardRef, type HTMLAttributes } from "react";

// Phase 12j — Card primitive. Base surface for story cards, gate
// overlays, upgrade prompts. The `interactive` variant adds the lift-
// on-hover affordance (translateY -2px + shadow swap). The
// `sectorAccent` prop adds a 3px left-border in the matching sector
// color — used by StoryCard.

export type CardSectorAccent = "ai" | "finance" | "semis" | null;

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
  sectorAccent?: CardSectorAccent;
  // Suppress the default shadow — useful for nested cards or modal
  // bodies where the parent already provides elevation.
  flat?: boolean;
}

const SECTOR_BORDER_CLASSES: Record<NonNullable<CardSectorAccent>, string> = {
  ai: "border-l-[3px] border-l-sector-ai",
  finance: "border-l-[3px] border-l-sector-finance",
  semis: "border-l-[3px] border-l-sector-semis",
};

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { interactive, sectorAccent, flat, className, ...rest },
  ref,
) {
  const cls = [
    "relative rounded-md bg-surface border border-line",
    flat ? "" : "shadow-card",
    interactive
      ? "transition-all duration-200 ease-soft-out hover:-translate-y-0.5 hover:shadow-card-hover"
      : "",
    sectorAccent ? SECTOR_BORDER_CLASSES[sectorAccent] : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return <div ref={ref} className={cls} {...rest} />;
});
