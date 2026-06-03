"use client";

import Link from "next/link";
import { Layers } from "lucide-react";
import type { Story } from "@/types/story";
import { FeatureImage } from "./FeatureImage";
import { sourceDisplayLabel, splitHook } from "@/lib/feedCard";
import { timeAgo } from "@/lib/timeAgo";

// Phase 12y — the "Developing" spotlight: a single widely-covered story
// (multiple sources) gets its own wide, image-led band, distinct from the
// lead and the sector sections. This is the "a topic that just happened /
// is ongoing gets its own special area" beat in the scroll rhythm.

const SECTOR_VAR: Record<string, string> = {
  ai: "var(--ai)",
  finance: "var(--finance)",
  semiconductors: "var(--semis)",
};
const SECTOR_NAME: Record<string, string> = {
  ai: "AI",
  finance: "Finance",
  semiconductors: "Semiconductors",
};

function titleFor(story: Story): { title: string; dek: string | null } {
  if (story.kind === "native") {
    return { title: story.headline, dek: story.why_it_matters_to_you || null };
  }
  const { hookTitle, commentaryBody } = splitHook(
    story.generic_commentary,
    story.headline,
  );
  return { title: hookTitle, dek: commentaryBody };
}

export function SpotlightBand({ story }: { story: Story }): JSX.Element {
  const color = SECTOR_VAR[story.sector] ?? "var(--ink-muted)";
  const sectorName = SECTOR_NAME[story.sector] ?? story.sector;
  const { title, dek } = titleFor(story);
  const stamp = timeAgo(story.published_at ?? story.created_at);
  const source = sourceDisplayLabel(story);
  const alternates = story.sources.filter((s) => s.role === "alternate");

  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <Layers className="h-3.5 w-3.5 text-accent" aria-hidden />
        <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-accent">
          Developing
        </h2>
      </div>

      <Link
        href={`/stories/${story.id}`}
        className="group grid grid-cols-1 overflow-hidden rounded-xl border border-line bg-surface shadow-card transition-shadow duration-200 hover:shadow-card-hover hover:no-underline md:grid-cols-[1.1fr_1fr]"
      >
        <FeatureImage
          story={story}
          className="aspect-[16/10] w-full md:aspect-auto md:h-full"
          sizes="(max-width: 768px) 100vw, 50vw"
        />
        <div className="flex min-w-0 flex-col justify-center gap-3 p-6 md:p-8">
          <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em]">
            <span className="font-medium" style={{ color }}>
              {sectorName}
            </span>
            {source && <span className="text-ink-muted">· {source}</span>}
          </span>
          <h3 className="font-display text-[26px] font-bold leading-[1.08] tracking-tight text-ink transition-colors duration-150 group-hover:text-accent md:text-[30px]">
            {title}
          </h3>
          {dek && (
            <p
              className="text-[15px] leading-relaxed text-ink-muted"
              style={{
                display: "-webkit-box",
                WebkitLineClamp: 3,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {dek}
            </p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] uppercase tracking-wide text-ink-muted">
            {stamp && <span>{stamp}</span>}
            {alternates.length > 0 && (
              <span className="normal-case tracking-normal">
                Also covered by{" "}
                {alternates
                  .slice(0, 3)
                  .map((s) => s.name ?? "another outlet")
                  .join(", ")}
                {alternates.length > 3 ? ` +${alternates.length - 3}` : ""}
              </span>
            )}
          </div>
        </div>
      </Link>
    </section>
  );
}
