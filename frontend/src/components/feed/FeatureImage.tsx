"use client";

import Image from "next/image";
import type { Story } from "@/types/story";
import { sourceDisplayLabel } from "@/lib/feedCard";
import { AiArtBadge } from "@/components/redesign/swiss/AiArtBadge";

// Phase 12y — the image primitive for the modular feed. Renders the
// story's og:image (or a native post's editorial illustration). When a
// story has no usable image, it falls back to a sector-tinted editorial
// panel with the sector wordmark + source — so every featured slot reads
// as "image-rich" rather than leaving a hole. This is what lets the feed
// emulate the image-led rhythm of Bloomberg/CNBC even though ingested
// og:images are inconsistent.

const SECTOR_VAR: Record<string, string> = {
  ai: "var(--ai)",
  finance: "var(--finance)",
  semiconductors: "var(--semis)",
};

const SECTOR_LABEL: Record<string, string> = {
  ai: "AI",
  finance: "FINANCE",
  semiconductors: "SEMICONDUCTORS",
};

export function FeatureImage({
  story,
  className,
  sizes = "(max-width: 768px) 100vw, 50vw",
  priority = false,
}: {
  story: Story;
  className?: string;
  sizes?: string;
  priority?: boolean;
}): JSX.Element {
  const src =
    story.image_url ?? (story.kind === "native" ? story.illustration_url : null);
  // The displayed image is the AI editorial illustration only when we fell
  // through to illustration_url — i.e. a native post with no scraped og:image.
  // The badge must never appear on a real sourced og:image.
  const isAiArt =
    !story.image_url && story.kind === "native" && Boolean(story.illustration_url);
  const color = SECTOR_VAR[story.sector] ?? "var(--ink-muted)";
  const sector = SECTOR_LABEL[story.sector] ?? story.sector.toUpperCase();
  const source = sourceDisplayLabel(story) ?? "VALO";

  if (src) {
    return (
      <div className={`relative overflow-hidden bg-surface ${className ?? ""}`}>
        <Image
          src={src}
          alt=""
          fill
          unoptimized
          priority={priority}
          sizes={sizes}
          className="object-cover transition-transform duration-[600ms] ease-soft-out group-hover:scale-[1.03]"
        />
        {isAiArt && <AiArtBadge />}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-1"
          style={{ backgroundColor: color }}
        />
      </div>
    );
  }

  // Fallback editorial panel — a sector-tinted gradient with the source
  // centered. Reads as intentional at any size (hero or 96px thumbnail),
  // keyed off design tokens so it re-skins across light/dark/terminal.
  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden ${className ?? ""}`}
      style={{
        background: `linear-gradient(135deg, color-mix(in srgb, ${color} 26%, var(--surface)) 0%, var(--surface) 72%)`,
      }}
    >
      <span className="flex max-w-full flex-col items-center gap-1.5 px-3 text-center">
        <span
          aria-hidden
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: color }}
        />
        <span className="truncate font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-ink">
          {source}
        </span>
        <span
          className="font-mono text-[9px] uppercase tracking-[0.14em]"
          style={{ color }}
        >
          {sector}
        </span>
      </span>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-1"
        style={{ backgroundColor: color }}
      />
    </div>
  );
}
