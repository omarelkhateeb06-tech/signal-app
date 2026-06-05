"use client";

import Link from "next/link";
import { Check, Lock } from "lucide-react";
import clsx from "clsx";
import type { Story, FeedGatedStory } from "@/types/story";
import { sourceDisplayLabel } from "@/lib/feedCard";
import { SECTOR_SHORT, matchPercent, storyTitleAndBrief } from "./swissView";
import { toggleStoryRead, useReadStories } from "./readStories";

// One entry in the ranked stream (left panel). The left is a pure
// scannable index — every row is collapsed; reading the full structured
// briefing happens in the right detail panel (scan left / read right). The
// active row (the one being read on the right) gets a terracotta marker.

function Kicker({
  rank,
  sector,
  readMinutes,
  sourceCount,
  sourceLabel,
  matchPct,
}: {
  rank: number;
  sector: string;
  readMinutes: number | null;
  sourceCount: number;
  sourceLabel: string | null;
  matchPct: number;
}): JSX.Element {
  // Source metadata is only worth a slot when it carries information: show a
  // count when a story is genuinely multi-source, otherwise the source name
  // (or nothing). Avoids the "1 SOURCES" noise repeating on every row.
  const sourceNote =
    sourceCount > 1
      ? `${sourceCount} sources`
      : sourceLabel
        ? `via ${sourceLabel}`
        : null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">
      <span className="font-semibold text-accent">
        {rank === 1 ? "Rank 1" : String(rank).padStart(2, "0")}
      </span>
      <span className="text-line">{"//"}</span>
      <span className="text-ink-muted">{SECTOR_SHORT[sector] ?? sector}</span>
      {readMinutes != null && <span>· {readMinutes} min read</span>}
      {sourceNote && <span>· {sourceNote}</span>}
      {rank > 1 && (
        <span className="border border-accent/40 px-1.5 py-0.5 font-semibold text-accent">
          {matchPct}% match
        </span>
      )}
    </div>
  );
}

interface StoryExhibitProps {
  story: Story;
  rank: number;
  /** True when this row is the story currently open in the detail panel. */
  isActive: boolean;
  onSelect: (storyId: string) => void;
}

export function StoryExhibit({
  story,
  rank,
  isActive,
  onSelect,
}: StoryExhibitProps): JSX.Element {
  const sourceCount = Math.max(1, story.sources.length);
  const matchPct = matchPercent(rank, sourceCount);
  const readMinutes = story.reading_time_minutes ?? null;
  const { title, brief } = storyTitleAndBrief(story);
  const isRead = useReadStories().has(story.id);

  // The top three carry larger headlines (visual weight decreases with rank).
  const headlineSize = rank <= 3 ? "text-[19px] md:text-[21px]" : "text-[17px]";

  // Worklist: read rows recede so the unread "still to work through" set
  // stays prominent. The whole row is still selectable; the check toggles
  // done independently.
  return (
    <div
      className={clsx(
        "group flex w-full items-start gap-3 border-b border-line py-5 transition-colors",
        isActive
          ? "border-l-[3px] border-l-accent bg-accent/[0.05] pl-3"
          : "hover:bg-surface/60",
        isRead && "opacity-55",
      )}
    >
      <button
        type="button"
        onClick={() => onSelect(story.id)}
        aria-pressed={isActive}
        className="min-w-0 flex-1 text-left"
      >
        <Kicker
          rank={rank}
          sector={story.sector}
          readMinutes={readMinutes}
          sourceCount={sourceCount}
          sourceLabel={sourceDisplayLabel(story)}
          matchPct={matchPct}
        />
        <h3
          className={clsx(
            "mt-2 font-display font-semibold leading-snug transition-colors",
            headlineSize,
            isActive ? "text-accent" : "text-ink group-hover:text-accent",
          )}
        >
          {title}
        </h3>
        {brief && (
          <p
            className="mt-1.5 font-serif text-[14px] italic leading-relaxed text-ink-muted"
            style={{
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {brief}
          </p>
        )}
      </button>

      <button
        type="button"
        onClick={() => toggleStoryRead(story.id)}
        aria-pressed={isRead}
        aria-label={isRead ? "Mark as unread" : "Mark as read"}
        title={isRead ? "Read — click to undo" : "Mark as read"}
        className={clsx(
          "mt-1 flex h-5 w-5 flex-none items-center justify-center rounded-full border transition-colors",
          isRead
            ? "border-accent bg-accent text-accent-fg"
            : "border-line text-transparent hover:border-accent hover:text-accent/40",
        )}
      >
        <Check className="h-3 w-3" aria-hidden />
      </button>
    </div>
  );
}

// Paywall soft-block as a ranked-stream row. Free-tier stories past the
// daily cap arrive as a gate envelope; we surface the teaser headline and
// route the whole row to the upgrade flow rather than selecting it.
export function GatedExhibit({
  item,
  rank,
}: {
  item: FeedGatedStory;
  rank: number;
}): JSX.Element {
  return (
    <Link
      href="/upgrade"
      className="group block border-b border-line py-5 hover:bg-surface/60 hover:no-underline"
    >
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">
        <span className="font-semibold text-ink-muted">
          {String(rank).padStart(2, "0")}
        </span>
        <span className="text-line">{"//"}</span>
        <Lock className="h-3 w-3 text-accent" aria-hidden />
        <span className="text-accent">Pro</span>
      </div>
      <h3 className="mt-2 font-display text-[18px] font-semibold leading-snug text-ink-muted blur-[1px] transition group-hover:blur-0">
        {item.teaser.headline}
      </h3>
      <p className="mt-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
        {item.upgrade_cta.message}
      </p>
    </Link>
  );
}
