"use client";

import Link from "next/link";
import { Lock } from "lucide-react";
import type { Story, FeedGatedStory } from "@/types/story";
import { sourceDisplayLabel } from "@/lib/feedCard";
import {
  SECTOR_SHORT,
  fullStoryView,
  indicatorsNote,
  matchPercent,
  storyTitleAndBrief,
} from "./swissView";
import { TakeawayList } from "./TakeawayList";

// One entry in the ranked stream (left panel). Collapsed by default;
// the currently-selected story renders its full structured briefing
// inline (Core Brief → Why It Matters → Key Takeaways → Indicators).

function SectionLabel({ children }: { children: string }): JSX.Element {
  return (
    <h4 className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">
      {children} <span className="text-line">{"//"}</span>
    </h4>
  );
}

function Kicker({
  rank,
  sector,
  readMinutes,
  sourceCount,
  matchPct,
}: {
  rank: number;
  sector: string;
  readMinutes: number | null;
  sourceCount: number;
  matchPct: number;
}): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">
      <span className="font-semibold text-accent">
        {rank === 1 ? "Rank 1" : String(rank).padStart(2, "0")}
      </span>
      <span className="text-line">{"//"}</span>
      <span className="text-ink-muted">{SECTOR_SHORT[sector] ?? sector}</span>
      {readMinutes != null && <span>· {readMinutes} min read</span>}
      <span className="text-ink-muted">· {sourceCount} sources</span>
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
  expanded: boolean;
  onSelect: (storyId: string) => void;
}

export function StoryExhibit({
  story,
  rank,
  expanded,
  onSelect,
}: StoryExhibitProps): JSX.Element {
  const sourceCount = Math.max(1, story.sources.length);
  const matchPct = matchPercent(rank, sourceCount);
  const readMinutes = story.reading_time_minutes ?? null;

  // Visual weight by rank: the top three carry larger headlines.
  const headlineSize = expanded
    ? "text-[26px] md:text-[30px]"
    : rank <= 3
      ? "text-[19px] md:text-[21px]"
      : "text-[17px]";

  if (!expanded) {
    const { title, brief } = storyTitleAndBrief(story);
    return (
      <button
        type="button"
        onClick={() => onSelect(story.id)}
        className="group block w-full border-b border-line py-5 text-left transition-colors hover:bg-surface/60"
      >
        <Kicker
          rank={rank}
          sector={story.sector}
          readMinutes={readMinutes}
          sourceCount={sourceCount}
          matchPct={matchPct}
        />
        <h3
          className={`mt-2 font-display ${headlineSize} font-semibold leading-snug text-ink transition-colors group-hover:text-accent`}
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

  const view = fullStoryView(story);
  const indicators = indicatorsNote(story);
  const source = sourceDisplayLabel(story);

  return (
    <article className="border-b border-line py-6">
      <Kicker
        rank={rank}
        sector={story.sector}
        readMinutes={readMinutes}
        sourceCount={sourceCount}
        matchPct={matchPct}
      />
      <h2
        className={`mt-3 font-display ${headlineSize} font-bold leading-[1.08] tracking-tight text-ink`}
      >
        {view.title}
      </h2>

      {view.brief && (
        <div className="mt-5">
          <SectionLabel>The Core Brief</SectionLabel>
          <p className="mt-2 text-[15px] leading-relaxed text-ink">{view.brief}</p>
        </div>
      )}

      {view.whyItMatters && (
        <div className="mt-5 border-l-[3px] border-accent bg-accent/[0.06] py-3 pl-4 pr-3">
          <SectionLabel>Why It Matters</SectionLabel>
          <p className="mt-2 font-serif text-[15px] italic leading-relaxed text-ink">
            {view.whyItMatters}
          </p>
        </div>
      )}

      {view.takeaways.length > 0 && (
        <div className="mt-5">
          <SectionLabel>Key Takeaways</SectionLabel>
          <TakeawayList storyId={story.id} takeaways={view.takeaways} />
        </div>
      )}

      {indicators && (
        <div className="mt-5">
          <SectionLabel>Indicators to Monitor</SectionLabel>
          <p className="mt-2 font-serif text-[14px] italic leading-relaxed text-ink-muted">
            {indicators}
          </p>
        </div>
      )}

      <div className="mt-5 flex items-center gap-4 border-t border-line pt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted">
        {source && <span className="text-ink">{source}</span>}
        <Link
          href={`/stories/${story.id}`}
          className="text-accent hover:text-accent-hover hover:no-underline"
        >
          Read in full →
        </Link>
      </div>
    </article>
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
