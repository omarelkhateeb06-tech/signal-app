"use client";

import Image from "next/image";
import type { Story } from "@/types/story";
import { sourceDisplayLabel } from "@/lib/feedCard";

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
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-1"
          style={{ backgroundColor: color }}
        />
      </div>
    );
  }

  // Fallback editorial panel — sector-tinted gradient + a large sector
  // watermark and the source name. Keyed entirely off design tokens so it
  // re-skins with light/dark and the terminal theme.
  return (
    <div
      className={`relative overflow-hidden ${className ?? ""}`}
      style={{
        background: `radial-gradient(120% 120% at 0% 0%, color-mix(in srgb, ${color} 30%, var(--surface)) 0%, var(--surface) 60%)`,
      }}
    >
      <span
        aria-hidden
        className="absolute -right-2 bottom-1 font-display text-[64px] font-bold leading-none opacity-[0.13]"
        style={{ color }}
      >
        {sector.slice(0, 3)}
      </span>
      <span className="absolute left-4 top-4 font-mono text-[10px] uppercase tracking-[0.18em]">
        <span style={{ color }}>{sector}</span>
      </span>
      <span className="absolute bottom-3 left-4 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted">
        {source}
      </span>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-1"
        style={{ backgroundColor: color }}
      />
    </div>
  );
}
