"use client";

import Link from "next/link";
import Image from "next/image";
import type { Story } from "@/types/story";
import { isNativeStory, sourceDisplayLabel, splitHook } from "@/lib/feedCard";

// A compact "cover" card — the same magazine treatment as the lead (image
// under a scrim with the headline overlaid in white), at secondary scale.
// Used to build a multi-cover front-page hero block beside the lead.

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

export function CoverCard({
  story,
  rank,
}: {
  story: Story;
  rank?: number;
}): JSX.Element {
  const native = isNativeStory(story);
  const img = story.image_url ?? (native ? story.illustration_url : null);
  const title = native
    ? story.headline
    : splitHook(story.generic_commentary, story.headline).hookTitle;
  const color = SECTOR_VAR[story.sector] ?? "var(--ink-muted)";
  const sector = SECTOR_SHORT[story.sector] ?? story.sector;
  const source = sourceDisplayLabel(story);

  return (
    <Link
      href={`/stories/${story.id}`}
      className="group relative block overflow-hidden rounded-xl border border-line hover:no-underline"
    >
      <div className="relative aspect-[16/9] w-full">
        {img ? (
          <Image
            src={img}
            alt=""
            fill
            unoptimized
            sizes="(max-width: 1024px) 100vw, 36vw"
            className="object-cover transition-transform duration-[600ms] ease-soft-out group-hover:scale-[1.04]"
          />
        ) : (
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background: `linear-gradient(135deg, color-mix(in srgb, ${color} 58%, #050505) 0%, #070707 78%)`,
            }}
          />
        )}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.45) 42%, rgba(0,0,0,0.05) 75%)",
          }}
        />
        {rank != null && (
          <span className="absolute left-3 top-3 inline-flex items-center rounded-md bg-black/55 px-2 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-white backdrop-blur-sm">
            #{rank}
          </span>
        )}
        <div className="absolute inset-x-0 bottom-0 p-4">
          <div className="mb-1.5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em]">
            <span className="inline-flex items-center gap-1.5 font-medium text-white">
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: color }}
              />
              {sector}
            </span>
            {source && <span className="truncate text-white/60">· {source}</span>}
          </div>
          <h3
            className="font-display text-[18px] font-bold leading-[1.12] tracking-tight text-white md:text-[21px]"
            style={{
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {title}
          </h3>
        </div>
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-1"
          style={{ backgroundColor: color }}
        />
      </div>
    </Link>
  );
}
