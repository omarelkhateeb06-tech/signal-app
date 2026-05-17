"use client";

// Phase 12d — expandable thesis/support commentary surface.
// Phase 12j — restyled onto the design tokens. Same data shape,
// same expand-collapse interaction; visual frame moves from
// violet → accent-tinted card so the surface reads as the same
// "personalized briefing" affordance throughout the app.

import { useState } from "react";
import { ChevronDown, Sparkles } from "lucide-react";
import type { CommentaryShape } from "@/types/story";

interface CommentaryProps {
  commentary: CommentaryShape;
}

export function Commentary({ commentary }: CommentaryProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="flex gap-3 rounded-lg border p-5"
      style={{
        backgroundColor: "color-mix(in srgb, var(--accent) 5%, var(--surface))",
        borderColor: "color-mix(in srgb, var(--accent) 22%, var(--line))",
      }}
    >
      <Sparkles className="mt-1 h-4 w-4 flex-shrink-0 text-accent" />
      <div className="flex-1 space-y-3">
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-accent">
          Why it matters
        </p>
        <p className="text-[15px] leading-[1.7] text-ink">
          {commentary.thesis}
        </p>
        <div
          className={`grid overflow-hidden transition-[grid-template-rows] duration-200 ease-soft-out ${
            expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
          }`}
          aria-hidden={!expanded}
        >
          <div className="min-h-0">
            <p className="pt-1 text-[15px] leading-[1.7] text-ink-muted">
              {commentary.support}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="inline-flex items-center gap-1 text-xs font-medium text-accent transition-colors hover:text-accent-hover hover:underline"
        >
          {expanded ? "Show less" : "Go deeper"}
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform duration-200 ${
              expanded ? "rotate-180" : ""
            }`}
          />
        </button>
      </div>
    </div>
  );
}
