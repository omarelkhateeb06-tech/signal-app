"use client";

import type { Story } from "@/types/story";
import { sourceDisplayLabel, splitHook } from "@/lib/feedCard";

// Phase 12y — shared primitives for the modular feed sections, so each
// distinct section LAYOUT (feature / triptych / mosaic / …) can share the
// same kicker, header, and title logic while differing structurally.

export const SECTOR_VAR: Record<string, string> = {
  ai: "var(--ai)",
  finance: "var(--finance)",
  semiconductors: "var(--semis)",
};

export const SECTOR_NAME: Record<string, string> = {
  ai: "Artificial Intelligence",
  finance: "Finance",
  semiconductors: "Semiconductors",
};

export function sectorColor(sector: string): string {
  return SECTOR_VAR[sector] ?? "var(--ink-muted)";
}

export function titleFor(story: Story): { title: string; dek: string | null } {
  if (story.kind === "native") {
    return { title: story.headline, dek: story.why_it_matters_to_you || null };
  }
  const { hookTitle, commentaryBody } = splitHook(
    story.generic_commentary,
    story.headline,
  );
  return { title: hookTitle, dek: commentaryBody };
}

export function SectionKicker({ story }: { story: Story }): JSX.Element {
  const source = sourceDisplayLabel(story);
  const color = sectorColor(story.sector);
  return (
    <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em]">
      <span className="inline-flex items-center gap-1.5 font-medium" style={{ color }}>
        <span
          aria-hidden
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: color }}
        />
        {(SECTOR_NAME[story.sector] ?? story.sector).split(" ")[0]}
      </span>
      {source && <span className="truncate text-ink-muted">· {source}</span>}
    </span>
  );
}

export function SectionHeader({
  sector,
  count,
}: {
  sector: string;
  count: number;
}): JSX.Element {
  const color = sectorColor(sector);
  const name = SECTOR_NAME[sector] ?? sector;
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden
        className="h-3 w-3 flex-none rounded-[3px]"
        style={{ backgroundColor: color }}
      />
      <h2 className="font-display text-[20px] font-bold tracking-tight text-ink">
        {name}
      </h2>
      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">
        {count} {count === 1 ? "story" : "stories"}
      </span>
      <span
        className="h-px flex-1"
        aria-hidden
        style={{
          background: `linear-gradient(90deg, color-mix(in srgb, ${color} 50%, var(--line)), transparent)`,
        }}
      />
    </div>
  );
}

export interface SectionProps {
  sector: string;
  stories: Story[];
}
