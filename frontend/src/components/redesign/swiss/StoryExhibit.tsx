"use client";

import Link from "next/link";
import { Lock, MessageSquare, Layers } from "lucide-react";
import clsx from "clsx";
import type { Story, FeedGatedStory } from "@/types/story";
import { sourceDisplayLabel } from "@/lib/feedCard";
import { deriveCardType, type FeedCardType } from "@/lib/feedCardType";
import { SECTOR_SHORT, matchPercent, storyTitleAndBrief } from "./swissView";

// One entry in the ranked stream (left panel). The left is a pure
// scannable index — every row is collapsed; reading the full structured
// briefing happens in the right detail panel (scan left / read right). The
// active row (the one being read on the right) gets a terracotta marker.
//
// Redesign v2: each row announces its content type with a branded label
// (THE RESEARCH READ, PRACTITIONER BRIEF, MULTI-SOURCE, …) so the stream
// reads as a varied briefing rather than an undifferentiated list. The
// flagship THE CONNECTION type is pulled out of this row entirely and
// rendered as a full-width hero by the parent stream.

// Native branded types carry the terracotta accent; ingested types stay
// quiet so the editorial signal pops against the news flow.
const ACCENTED_TYPES: ReadonlySet<FeedCardType> = new Set([
  "connection",
  "research",
  "practitioner",
  "tool",
  "native",
]);

function TypeLabel({ type, label }: { type: FeedCardType; label: string }): JSX.Element {
  const accented = ACCENTED_TYPES.has(type);
  return (
    <div className="mb-1.5 flex items-center gap-2">
      <span
        aria-hidden
        className={clsx(
          "h-2.5 w-2.5 flex-none",
          accented ? "bg-accent" : "border border-ink-muted",
        )}
      />
      <span
        className={clsx(
          "font-mono text-[10px] font-semibold uppercase tracking-[0.2em]",
          accented ? "text-accent" : "text-ink-muted",
        )}
      >
        {label}
      </span>
    </div>
  );
}

function Kicker({
  rank,
  sector,
  readMinutes,
  sourceCount,
  sourceLabel,
  matchPct,
  typeNote,
}: {
  rank: number;
  sector: string;
  readMinutes: number | null;
  sourceCount: number;
  sourceLabel: string | null;
  matchPct: number;
  /** Per-type meta (e.g. discussion count, source breadth). */
  typeNote?: JSX.Element | null;
}): JSX.Element {
  // The branded TypeLabel above already names the source family, so the
  // kicker only carries the plain source attribution for single-source
  // ingested rows where the outlet name adds information. `typeNote` handles
  // multi-source / discussion breadth, so we don't double up here.
  const sourceNote =
    !typeNote && sourceCount === 1 && sourceLabel ? `via ${sourceLabel}` : null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">
      <span className="font-semibold text-accent">
        {rank === 1 ? "Rank 1" : String(rank).padStart(2, "0")}
      </span>
      <span className="text-line">{"//"}</span>
      <span className="text-ink-muted">{SECTOR_SHORT[sector] ?? sector}</span>
      {readMinutes != null && <span>· {readMinutes} min read</span>}
      {sourceNote && <span>· {sourceNote}</span>}
      {typeNote && <span>· {typeNote}</span>}
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
  const { type, label } = deriveCardType(story);

  // Per-type enrichment in the meta line: practitioner briefs surface the
  // discussion volume they synthesize; clusters surface their source breadth.
  const typeNote =
    type === "practitioner" && story.comment_count > 0 ? (
      <span className="inline-flex items-center gap-1">
        <MessageSquare className="h-3 w-3" aria-hidden />
        {story.comment_count} discussed
      </span>
    ) : type === "cluster" ? (
      <span className="inline-flex items-center gap-1 text-accent">
        <Layers className="h-3 w-3" aria-hidden />+{sourceCount - 1} more sources
      </span>
    ) : null;

  // The top three carry larger headlines (visual weight decreases with rank).
  const headlineSize = rank <= 3 ? "text-[19px] md:text-[21px]" : "text-[17px]";

  return (
    <button
      type="button"
      onClick={() => onSelect(story.id)}
      aria-pressed={isActive}
      className={clsx(
        "group block w-full border-b border-line py-5 text-left transition-colors",
        isActive
          ? "border-l-[3px] border-l-accent bg-accent/[0.05] pl-3"
          : "hover:bg-surface/60",
      )}
    >
      <TypeLabel type={type} label={label} />
      <Kicker
        rank={rank}
        sector={story.sector}
        readMinutes={readMinutes}
        sourceCount={sourceCount}
        sourceLabel={sourceDisplayLabel(story)}
        matchPct={matchPct}
        typeNote={typeNote}
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
