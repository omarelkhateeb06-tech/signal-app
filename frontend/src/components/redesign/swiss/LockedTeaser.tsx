"use client";

import { Lock } from "lucide-react";

// Redesign v2 — stickiness item 3 (the conversion hook).
//
// The moat is the personalized "why it matters to YOU". Hiding it entirely
// behind the paywall means a free user never feels what they're missing, so
// they never convert (Hormozi). This surfaces a *blurred* slice of the
// personalized read with an explicit unlock — the value is visible, the words
// are not. The blurred text is real `why_it_matters_to_you` from the wire, so
// the shape and length read as genuine rather than a lorem placeholder.

interface LockedTeaserProps {
  /** The personalized read to tease (rendered blurred). */
  text: string;
  /** The reader's role, woven into the CTA when known. */
  roleLabel?: string | null;
}

export function LockedTeaser({ text, roleLabel }: LockedTeaserProps): JSX.Element {
  return (
    <div className="mt-2.5 border-l-2 border-accent/40 pl-3">
      <p className="flex items-center gap-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-accent">
        <Lock className="h-3 w-3" aria-hidden />
        {roleLabel ? `Your read as a ${roleLabel}` : "Your personalized read"}
        <span className="text-line">·</span>
        <span>Pro</span>
      </p>
      <p
        className="mt-1 select-none font-serif text-[13px] italic leading-relaxed text-ink-muted blur-[3.5px]"
        aria-hidden
        style={{
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {text}
      </p>
    </div>
  );
}
