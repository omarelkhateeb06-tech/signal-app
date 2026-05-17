"use client";

import { Lock } from "lucide-react";
import type { DepthOverride } from "@/hooks/useStoryCommentary";

const DEPTH_OPTIONS: ReadonlyArray<{ value: DepthOverride; label: string }> = [
  { value: "accessible", label: "Accessible" },
  { value: "briefed", label: "Briefed" },
  { value: "technical", label: "Technical" },
];

// Phase 12g — depth toggle with free-tier visual lock. Briefed and
// technical render with a lock icon for free users; clicking a locked
// option does NOT fire a commentary request — the parent surfaces an
// inline upgrade prompt instead (see StoryDetail).
//
// Pro / pro_trial users see no locks; clicks pass through to the
// `onSelect` handler which the parent maps onto useStoryCommentary's
// `depth` option.
export interface DepthToggleProps {
  value: DepthOverride;
  onSelect: (depth: DepthOverride) => void;
  // When true (free tier), briefed + technical are locked. The
  // toggle still surfaces the click so the parent can show the
  // inline upgrade prompt.
  lockHigherTiers: boolean;
  // Forwarded to lock click — parent decides what to do (typically
  // open the inline upgrade card).
  onLockedClick?: (attempted: DepthOverride) => void;
}

export function DepthToggle({
  value,
  onSelect,
  lockHigherTiers,
  onLockedClick,
}: DepthToggleProps): JSX.Element {
  return (
    <div
      className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-1 text-sm"
      role="tablist"
      aria-label="Commentary depth"
    >
      {DEPTH_OPTIONS.map((opt) => {
        const isLocked =
          lockHigherTiers && (opt.value === "briefed" || opt.value === "technical");
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
              "inline-flex items-center gap-1 rounded px-3 py-1.5 transition-colors",
              isActive
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-600 hover:text-slate-900",
              isLocked ? "opacity-70" : "",
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
