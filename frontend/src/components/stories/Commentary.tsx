"use client";

// Phase 12d — expandable thesis/support commentary surface.
//
// Reads the structured CommentaryShape and renders thesis by default
// with a "Go deeper" button that toggles support visibility. State is
// pure session-scope `useState` per Decision 12d.3 — preference is not
// persisted across reloads so a fresh visit always lands on the
// thesis-only view.
//
// Visual frame matches PersonalizationBox (icon + violet rule) for
// continuity; this is the 12c surface upgraded, not a new shelf. The
// component intentionally stays minimal in this commit: thesis,
// button, support panel, 200ms slide. Polish iterates in 12d.1.

import { useState } from "react";
import { ChevronDown, Sparkles } from "lucide-react";
import type { CommentaryShape } from "@/types/story";

interface CommentaryProps {
  commentary: CommentaryShape;
}

export function Commentary({ commentary }: CommentaryProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="flex gap-3 rounded-lg border border-violet-200 bg-violet-50/60 p-4">
      <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0 text-violet-600" />
      <div className="flex-1 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">
          Why it matters
        </p>
        <p className="text-sm leading-relaxed text-slate-800">
          {commentary.thesis}
        </p>
        <div
          className={`grid overflow-hidden transition-[grid-template-rows] duration-200 ease-out ${
            expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
          }`}
          aria-hidden={!expanded}
        >
          <div className="min-h-0">
            <p className="pt-2 text-sm leading-relaxed text-slate-700">
              {commentary.support}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="inline-flex items-center gap-1 text-xs font-medium text-violet-700 hover:text-violet-900"
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
