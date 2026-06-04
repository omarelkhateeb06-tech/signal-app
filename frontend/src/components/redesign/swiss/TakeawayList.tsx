"use client";

import { Bookmark } from "lucide-react";
import {
  takeawayKey,
  toggleSavedTakeaway,
  useSavedTakeaways,
} from "./savedTakeaways";

// Key-takeaway bullets with a per-bullet save (bookmark) affordance. The
// bookmark is the briefing's one active-engagement layer — a reader can
// pull a single takeaway out of a story into their saved set. Shared by
// the left exhibit and the right detail panel so both reflect the same
// saved state.

export function TakeawayList({
  storyId,
  takeaways,
}: {
  storyId: string;
  takeaways: string[];
}): JSX.Element {
  const saved = useSavedTakeaways();

  return (
    <ul className="mt-2 space-y-1.5">
      {takeaways.map((t, i) => {
        const key = takeawayKey(storyId, i);
        const isSaved = saved.has(key);
        return (
          <li
            key={i}
            className="group/ta flex items-start gap-2 text-[14px] leading-relaxed text-ink"
          >
            <span aria-hidden className="mt-[2px] flex-none text-accent">
              •
            </span>
            <span className="flex-1">{t}</span>
            <button
              type="button"
              onClick={() => toggleSavedTakeaway(key)}
              aria-pressed={isSaved}
              aria-label={isSaved ? "Unsave takeaway" : "Save takeaway"}
              className={[
                "mt-[1px] flex-none transition-opacity focus-visible:opacity-100",
                isSaved
                  ? "text-accent opacity-100"
                  : "text-ink-muted opacity-0 hover:text-accent group-hover/ta:opacity-100",
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
