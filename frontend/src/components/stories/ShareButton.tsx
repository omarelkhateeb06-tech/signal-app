"use client";

import { useState } from "react";
import { Share2, Check } from "lucide-react";
import type { Story } from "@/types/story";
import { trackEngagement } from "@/lib/engagementTracker";

// Phase 12o (3C) — share affordance on the story detail. Uses the native Web
// Share sheet when available (mobile / modern browsers), otherwise copies the
// canonical story link to the clipboard with a transient "Copied" state. Emits
// a `share` engagement event either way — share is both a behavioural signal
// for Ranking v2 and a distribution lever (the roadmap's "unsolved problem").
export function ShareButton({ story }: { story: Story }): JSX.Element {
  const [copied, setCopied] = useState(false);

  const handleShare = async (): Promise<void> => {
    const url =
      typeof window !== "undefined"
        ? `${window.location.origin}/stories/${story.id}`
        : `/stories/${story.id}`;

    trackEngagement({ event_type: "share", event_id: story.id });

    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: story.headline, url });
        return;
      } catch {
        // User dismissed the sheet, or share failed — fall through to copy.
      }
    }

    if (typeof navigator !== "undefined" && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // Clipboard blocked (insecure context / permissions) — nothing to do.
      }
    }
  };

  return (
    <button
      type="button"
      onClick={() => void handleShare()}
      aria-label="Share this story"
      className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted transition-colors hover:text-accent"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <Share2 className="h-3.5 w-3.5" aria-hidden />
      )}
      {copied ? "Copied" : "Share"}
    </button>
  );
}
