"use client";

import { Lock } from "lucide-react";
import { useMemo } from "react";
import type { DepthOverride } from "@/hooks/useStoryCommentary";

// Phase 12j — depth toggle with a sliding active indicator. Three
// segments (Accessible / Briefed / Technical) on a single rail; the
// active background is a single absolutely-positioned element whose
// `left` and `width` animate between the segment slots via CSS
// transition. Free-tier users see a lock icon on Briefed + Technical;
// clicking a locked segment short-circuits the onSelect callback and
// fires onLockedClick instead (parent renders the inline upgrade
// card — see StoryDetail).

const DEPTH_OPTIONS: ReadonlyArray<{
  value: DepthOverride;
  label: string;
}> = [
  { value: "accessible", label: "Accessible" },
  { value: "briefed", label: "Briefed" },
  { value: "technical", label: "Technical" },
];

const SEGMENT_COUNT = DEPTH_OPTIONS.length;
const SEGMENT_PCT = 100 / SEGMENT_COUNT;

export interface DepthToggleProps {
  value: DepthOverride;
  onSelect: (depth: DepthOverride) => void;
  lockHigherTiers: boolean;
  onLockedClick?: (attempted: DepthOverride) => void;
}

export function DepthToggle({
  value,
  onSelect,
  lockHigherTiers,
  onLockedClick,
}: DepthToggleProps): JSX.Element {
  const activeIndex = useMemo(
    () => Math.max(0, DEPTH_OPTIONS.findIndex((o) => o.value === value)),
    [value],
  );

  // The active slot lives in the inner padding rail (2px on each
  // side). Translating by activeIndex * segment width inside the
  // rail keeps the indicator pixel-aligned with the segment hit area.
  const indicatorStyle: React.CSSProperties = {
    width: `calc(${SEGMENT_PCT}% - 4px)`,
    transform: `translateX(${activeIndex * 100}%)`,
  };

  return (
    <div
      role="tablist"
      aria-label="Commentary depth"
      className="relative inline-flex w-full max-w-[420px] items-stretch rounded-md border border-line bg-bg p-1"
    >
      {/* Sliding active indicator */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1 top-1 bottom-1 rounded-[6px] bg-surface shadow-card transition-transform duration-200 ease-soft-out"
        style={indicatorStyle}
      />
      {DEPTH_OPTIONS.map((opt) => {
        const isLocked =
          lockHigherTiers &&
          (opt.value === "briefed" || opt.value === "technical");
        const isActive = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            data-testid={`depth-toggle-${opt.value}`}
            onClick={() => {
              if (isLocked) {
                onLockedClick?.(opt.value);
                return;
              }
              onSelect(opt.value);
            }}
            className={[
              "relative z-10 flex flex-1 items-center justify-center gap-1.5",
              "rounded-[6px] px-3 py-1.5 text-sm font-medium",
              "transition-colors duration-200 ease-soft-out",
              isActive
                ? "text-ink"
                : "text-ink-muted hover:text-ink",
              isLocked ? "opacity-90" : "",
            ].join(" ")}
          >
            {isLocked && <Lock className="h-3 w-3" aria-hidden />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
