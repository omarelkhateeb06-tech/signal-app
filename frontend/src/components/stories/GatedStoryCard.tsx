"use client";

import { Lock } from "lucide-react";
import { SectorBadge } from "./SectorBadge";
import { UpgradeCtaButton } from "./UpgradeCta";
import type { FeedGatedStory } from "@/types/story";

// Phase 12g — soft-block render for a feed row beyond the free-tier
// daily cap. Per spec: headline + first line of generic commentary
// remain visible; everything below blurs behind an upgrade overlay.
// The card stays clickable-looking but the overlay sits above the
// blur — users can scroll past gated cards without dismissing
// anything (no modal, no toast).
export function GatedStoryCard({ story }: { story: FeedGatedStory }): JSX.Element {
  return (
    <article
      className="relative overflow-hidden rounded-lg border border-slate-200 bg-white p-6"
      data-testid="gated-story-card"
    >
      <div className="pointer-events-none select-none">
        <div className="mb-3 flex items-center gap-2">
          <SectorBadge sector={story.sector} />
        </div>
        <h2 className="mb-2 text-xl font-semibold leading-tight text-slate-900">
          {story.teaser.headline}
        </h2>
        <p className="text-sm leading-relaxed text-slate-600">
          {story.teaser.first_line}
        </p>
        {/* Blurred filler so the overlay anchors to a card-shaped area
            rather than collapsing. The text is decorative — actual
            content stays server-side. */}
        <div
          className="mt-4 space-y-2 blur-sm"
          aria-hidden
        >
          <div className="h-3 rounded bg-slate-200" />
          <div className="h-3 w-11/12 rounded bg-slate-200" />
          <div className="h-3 w-10/12 rounded bg-slate-200" />
        </div>
      </div>

      <div className="absolute inset-x-6 bottom-6 flex flex-col items-start gap-3 rounded-md border border-violet-200 bg-violet-50/95 p-4 shadow-sm">
        <div className="flex items-start gap-2 text-sm text-violet-900">
          <Lock className="mt-0.5 h-4 w-4 flex-none" aria-hidden />
          <span>{story.upgrade_cta.message}</span>
        </div>
        <UpgradeCtaButton cta={story.upgrade_cta} />
      </div>
    </article>
  );
}
