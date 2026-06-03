"use client";

import Link from "next/link";
import { MessageSquare } from "lucide-react";
import type { Story } from "@/types/story";
import { FeatureImage } from "./FeatureImage";
import { sourceDisplayLabel, splitHook } from "@/lib/feedCard";
import { timeAgo } from "@/lib/timeAgo";

// Phase 12y — a per-sector "band": each industry gets its own section with
// a distinct header, one image-led featured story, and a supporting list.
// Stacking several of these (AI / Finance / Semis) gives the feed rhythm
// and variety as the reader scrolls, instead of a uniform grid.

const SECTOR_VAR: Record<string, string> = {
  ai: "var(--ai)",
  finance: "var(--finance)",
  semiconductors: "var(--semis)",
};

const SECTOR_NAME: Record<string, string> = {
  ai: "Artificial Intelligence",
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

function Kicker({ story }: { story: Story }): JSX.Element {
  const source = sourceDisplayLabel(story);
  const color = SECTOR_VAR[story.sector] ?? "var(--ink-muted)";
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

function SupportingItem({ story }: { story: Story }): JSX.Element {
  const { title } = titleFor(story);
  const stamp = timeAgo(story.published_at ?? story.created_at);
  return (
    <li>
      <Link
        href={`/stories/${story.id}`}
        className="group block py-3 hover:no-underline"
      >
        <span className="mb-1 block">
          <Kicker story={story} />
        </span>
        <h4 className="font-display text-[16px] font-semibold leading-snug text-ink transition-colors duration-150 group-hover:text-accent">
          {title}
        </h4>
        {stamp && (
          <span className="mt-1 block font-mono text-[10px] uppercase tracking-wide text-ink-muted">
            {stamp}
          </span>
        )}
      </Link>
    </li>
  );
}

export function SectorSection({
  sector,
  stories,
}: {
  sector: string;
  stories: Story[];
}): JSX.Element | null {
  if (stories.length === 0) return null;
  const [featured, ...supporting] = stories;
  const color = SECTOR_VAR[sector] ?? "var(--ink-muted)";
  const name = SECTOR_NAME[sector] ?? sector;
  const { title, dek } = titleFor(featured);
  const stamp = timeAgo(featured.published_at ?? featured.created_at);

  return (
    <section className="space-y-5">
      {/* Section header — sector wordmark + colored rule */}
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
          {stories.length} {stories.length === 1 ? "story" : "stories"}
        </span>
        <span
          className="h-px flex-1"
          aria-hidden
          style={{
            background: `linear-gradient(90deg, color-mix(in srgb, ${color} 50%, var(--line)), transparent)`,
          }}
        />
      </div>

      <div className="grid grid-cols-1 gap-x-8 gap-y-6 lg:grid-cols-[1.4fr_1fr]">
        {/* Featured — image-led */}
        <article className="min-w-0">
          <Link href={`/stories/${featured.id}`} className="group block hover:no-underline">
            <FeatureImage
              story={featured}
              className="aspect-[16/9] w-full rounded-lg border border-line"
              sizes="(max-width: 1024px) 100vw, 55vw"
            />
            <div className="mt-3">
              <Kicker story={featured} />
              <h3 className="mt-2 font-display text-[24px] font-bold leading-[1.12] tracking-tight text-ink transition-colors duration-150 group-hover:text-accent">
                {title}
              </h3>
              {dek && (
                <p
                  className="mt-2 text-[14px] leading-relaxed text-ink-muted"
                  style={{
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {dek}
                </p>
              )}
            </div>
          </Link>
          <div className="mt-3 flex items-center gap-4 font-mono text-[10px] uppercase tracking-wide text-ink-muted">
            {stamp && <span>{stamp}</span>}
            {featured.reading_time_minutes != null && (
              <span>{featured.reading_time_minutes} min</span>
            )}
            {featured.comment_count > 0 && (
              <span className="inline-flex items-center gap-1 normal-case tracking-normal">
                <MessageSquare className="h-3.5 w-3.5" />
                {featured.comment_count}
              </span>
            )}
          </div>
        </article>

        {/* Supporting list */}
        {supporting.length > 0 && (
          <ul className="min-w-0 divide-y divide-line lg:border-l lg:border-line lg:pl-8">
            {supporting.map((s) => (
              <SupportingItem key={s.id} story={s} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
