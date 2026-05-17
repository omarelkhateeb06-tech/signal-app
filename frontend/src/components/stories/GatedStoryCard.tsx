"use client";

import { Lock } from "lucide-react";
import { SectorBadge } from "./SectorBadge";
import { UpgradeCtaButton } from "./UpgradeCta";
import { Card, type CardSectorAccent } from "@/components/ui/Card";
import type { FeedGatedStory } from "@/types/story";

// Phase 12j — gated story card. Same outer footprint as a normal
// StoryCard so the feed has a uniform rhythm (cards don't collapse
// or jump). Headline + first line stay visible at full opacity; the
// body region under them blurs into a CSS gradient mask, with the
// upgrade CTA centered over the blurred zone. The card stays
// scrollable past — no modal, no eject.

function sectorAccentFor(sector: string): CardSectorAccent {
  if (sector === "ai") return "ai";
  if (sector === "finance") return "finance";
  if (sector === "semiconductors") return "semis";
  return null;
}

export function GatedStoryCard({
  story,
  index = 0,
}: {
  story: FeedGatedStory;
  index?: number;
}): JSX.Element {
  const staggerDelay = index < 10 ? `${index * 40}ms` : "0ms";
  return (
    <Card
      data-testid="gated-story-card"
      sectorAccent={sectorAccentFor(story.sector)}
      className="relative overflow-hidden p-6 animate-fade-up"
      style={{ animationDelay: staggerDelay }}
    >
      {/* Visible region: sector badge + headline + first line. */}
      <div className="mb-3">
        <SectorBadge sector={story.sector} />
      </div>
      <h2 className="mb-2 font-display text-[20px] font-semibold leading-snug text-ink">
        {story.teaser.headline}
      </h2>
      <p className="text-sm leading-relaxed text-ink-muted">
        {story.teaser.first_line}
      </p>

      {/* Blurred region: card-shaped placeholder content under a
          backdrop blur. The CSS gradient mask fades from solid at the
          top to transparent at the bottom so the blur feels like the
          rest of the card is still there, just out of focus. */}
      <div
        aria-hidden
        className="mt-4 space-y-2 gate-blur"
        style={{
          maskImage:
            "linear-gradient(to bottom, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.25) 90%)",
          WebkitMaskImage:
            "linear-gradient(to bottom, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.25) 90%)",
        }}
      >
        <div className="h-3 rounded bg-line" />
        <div className="h-3 w-11/12 rounded bg-line" />
        <div className="h-3 w-10/12 rounded bg-line" />
        <div className="h-3 w-8/12 rounded bg-line" />
      </div>

      {/* Upgrade overlay — sits over the blurred region, integrated
          with the card rather than as a modal. Warm semi-transparent
          backdrop using color-mix() against the surface color so it
          looks like a natural extension of the card. */}
      <div
        className="absolute inset-x-6 bottom-6 flex flex-col items-start gap-3 rounded-md border border-line p-4"
        style={{
          backgroundColor: "color-mix(in srgb, var(--surface) 92%, transparent)",
          backdropFilter: "blur(4px)",
          WebkitBackdropFilter: "blur(4px)",
        }}
      >
        <div className="flex items-start gap-2 text-sm text-ink">
          <Lock className="mt-0.5 h-4 w-4 flex-none text-accent" aria-hidden />
          <span>{story.upgrade_cta.message}</span>
        </div>
        <UpgradeCtaButton cta={story.upgrade_cta} size="sm" />
      </div>
    </Card>
  );
}
