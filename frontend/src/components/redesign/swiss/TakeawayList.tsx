"use client";

import { Bookmark } from "lucide-react";
import {
  takeawayKey,
  toggleSavedTakeaway,
  useSavedTakeaways,
} from "./savedTakeaways";

// Key-takeaway bullets with a per-bullet save (bookmark) affordance. The
// bookmark is the briefing's one active-engagement layer — a reader can
// pull a single takeaway into their saved set, which gets a home in the
// profile sidebar. The control is always visible and keyboard-reachable
// (a real button), not a hover-only reveal.

export function TakeawayList({
  storyId,
  takeaways,
}: {
  storyId: string;
  takeaways: string[];
}): JSX.Element {
  const saved = useSavedTakeaways();

  return (
    <ul className="mt-2 space-y-2">
      {takeaways.map((t, i) => {
        const key = takeawayKey(storyId, i);
        const isSaved = saved.has(key);
        return (
          <li
            key={i}
            className="flex items-start gap-2 text-[14px] leading-relaxed text-ink"
          >
            <span aria-hidden className="mt-[2px] flex-none text-accent">
              •
            </span>
            <span className="flex-1">{t}</span>
            <button
              type="button"
              onClick={() => toggleSavedTakeaway({ key, storyId, text: t })}
              aria-pressed={isSaved}
              aria-label={isSaved ? "Remove saved takeaway" : "Save takeaway"}
              title={isSaved ? "Saved — click to remove" : "Save this takeaway"}
              className={[
                "mt-[1px] flex-none rounded-[2px] p-0.5 transition-colors",
                isSaved
                  ? "text-accent"
                  : "text-ink-muted/50 hover:text-accent focus-visible:text-accent",
              ].join(" ")}
            >
              <Bookmark
                className={`h-3.5 w-3.5 ${isSaved ? "fill-current" : ""}`}
                aria-hidden
              />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
