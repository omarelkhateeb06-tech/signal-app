"use client";

import { Badge } from "@/components/ui/Badge";

// Phase 12j — sector pill. Wraps the Badge primitive so the legacy
// import path (components/stories/SectorBadge) keeps working while
// the styling flows from the design tokens.

const SECTOR_TO_TONE: Record<string, "ai" | "finance" | "semis" | "neutral"> = {
  ai: "ai",
  finance: "finance",
  // Stored slug is "semiconductors"; design-system token is "semis".
  semiconductors: "semis",
};

const SECTOR_LABELS: Record<string, string> = {
  ai: "AI",
  finance: "Finance",
  semiconductors: "Semiconductors",
};

export function SectorBadge({
  sector,
  variant = "tinted",
}: {
  sector: string;
  variant?: "tinted" | "filled";
}): JSX.Element {
  const tone = SECTOR_TO_TONE[sector] ?? "neutral";
  const label = SECTOR_LABELS[sector] ?? sector;
  return (
    <Badge tone={tone} variant={variant}>
      <span
        aria-hidden
        className="h-1.5 w-1.5 rounded-full"
        style={{
          backgroundColor:
            tone === "ai"
              ? "var(--ai)"
              : tone === "finance"
                ? "var(--finance)"
                : tone === "semis"
                  ? "var(--semis)"
                  : "var(--ink-muted)",
        }}
      />
      {label}
    </Badge>
  );
}
