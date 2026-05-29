"use client";

import { Lock } from "lucide-react";
import { motion } from "framer-motion";
import { UpgradeCtaButton } from "./UpgradeCta";
import { Card, type CardSectorAccent } from "@/components/ui/Card";
import { storyCardVariants } from "./StoryCard";
import type { FeedGatedStory } from "@/types/story";

const EASE: [number, number, number, number] = [0.2, 0.8, 0.2, 1];

const SECTOR_VAR: Record<string, string> = {
  ai: "var(--ai)",
  finance: "var(--finance)",
  semiconductors: "var(--semis)",
};

const SECTOR_SHORT: Record<string, string> = {
  ai: "AI",
  finance: "Finance",
  semiconductors: "Semiconductors",
};

function sectorAccentFor(sector: string): CardSectorAccent {
  if (sector === "ai") return "ai";
  if (sector === "finance") return "finance";
  if (sector === "semiconductors") return "semis";
  return null;
}

export function GatedStoryCard({
  story,
  animated = false,
}: {
  story: FeedGatedStory;
  index?: number;
  animated?: boolean;
}): JSX.Element {
  const sectorColor = SECTOR_VAR[story.sector] ?? "var(--ink-muted)";

  return (
    <motion.div
      variants={animated ? storyCardVariants : undefined}
      whileHover={{ y: -2, transition: { duration: 0.15, ease: EASE } }}
      className="h-full"
    >
      <Card
        data-testid="gated-story-card"
        sectorAccent={sectorAccentFor(story.sector)}
        className="relative flex h-full flex-col overflow-hidden p-5"
      >
        {/* Sector kicker — same editorial dateline as every other card */}
        <div className="mb-2 flex items-center gap-2">
          <span
            className="inline-flex items-center gap-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em]"
            style={{ color: sectorColor }}
          >
            <span
              aria-hidden
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: sectorColor }}
            />
            {SECTOR_SHORT[story.sector] ?? story.sector}
          </span>
        </div>

        <h2 className="mb-2 font-display text-[19px] font-semibold leading-snug text-ink">
          {story.teaser.headline}
        </h2>
        <p className="text-sm leading-relaxed text-ink-muted">
          {story.teaser.first_line}
        </p>

        {/* Locked region — blurred placeholder lines fading out, with the
            upgrade prompt integrated as a premium inline panel. */}
        <div className="relative mt-3 flex-1">
          <div
            aria-hidden
            className="space-y-2"
            style={{
              maskImage:
                "linear-gradient(to bottom, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0) 80%)",
              WebkitMaskImage:
                "linear-gradient(to bottom, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0) 80%)",
            }}
          >
            <div className="h-2.5 rounded bg-line" />
            <div className="h-2.5 w-11/12 rounded bg-line" />
            <div className="h-2.5 w-9/12 rounded bg-line" />
          </div>
        </div>

        <div
          className="mt-3 flex items-center justify-between gap-3 rounded-md border px-3 py-2.5"
          style={{
            backgroundColor: "color-mix(in srgb, var(--accent) 6%, var(--surface))",
            borderColor: "color-mix(in srgb, var(--accent) 22%, var(--line))",
          }}
        >
          <span className="inline-flex items-center gap-2 text-xs text-ink">
            <Lock className="h-3.5 w-3.5 flex-none text-accent" aria-hidden />
            <span className="line-clamp-2">{story.upgrade_cta.message}</span>
          </span>
          <UpgradeCtaButton cta={story.upgrade_cta} size="sm" />
        </div>
      </Card>
    </motion.div>
  );
}
