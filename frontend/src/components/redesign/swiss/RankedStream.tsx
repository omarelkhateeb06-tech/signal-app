"use client";

import { type RefObject } from "react";
import { SectorFilter } from "@/components/feed/SectorFilter";
import { isConnectionStory } from "@/lib/feedCardType";
import { isGatedFeedItem, type FeedItem } from "@/types/story";
import { ConnectionHero } from "./ConnectionHero";
import { GatedExhibit, StoryExhibit } from "./StoryExhibit";

// Left panel: the ranked stream — a pure scannable index. Every entry is a
// collapsed, clickable row; the active row (open in the detail panel) is
// highlighted. Reading happens on the right. Rank is 1-based position in
// the feed (gated rows included), so MATCH % stays aligned with feed order.

interface RankedStreamProps {
  items: FeedItem[];
  /** Id of the story currently open in the detail panel (highlighted). */
  activeId: string | null;
  onSelect: (storyId: string) => void;
  sectors: string[];
  onSectorsChange: (next: string[]) => void;
  sentinelRef: RefObject<HTMLDivElement>;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
}

export function RankedStream({
  items,
  activeId,
  onSelect,
  sectors,
  onSectorsChange,
  sentinelRef,
  isFetchingNextPage,
  hasNextPage,
}: RankedStreamProps): JSX.Element {
  // Redesign v2: the highest-ranked cross-sector chain is promoted out of the
  // uniform row list into a full-width illustrated hero at the top of the
  // stream — the flagship type breaks the grid. Its original rank is
  // preserved (match % stays aligned with feed order); the rest render in
  // order, with the hoisted story skipped so it isn't shown twice.
  const heroIndex = items.findIndex(
    (item) => !isGatedFeedItem(item) && isConnectionStory(item),
  );
  const heroItem =
    heroIndex >= 0 ? items[heroIndex] : null;

  return (
    <section className="min-w-0 px-6 py-6 md:px-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-mono text-[12px] font-semibold uppercase tracking-[0.2em] text-ink">
          Ranked Stream
        </h2>
        <SectorFilter selected={sectors} onChange={onSectorsChange} />
      </div>

      {heroItem && !isGatedFeedItem(heroItem) && (
        <ConnectionHero
          story={heroItem}
          rank={heroIndex + 1}
          isActive={heroItem.id === activeId}
          onSelect={onSelect}
        />
      )}

      <div>
        {items.map((item, i) => {
          if (i === heroIndex) return null;
          const rank = i + 1;
          if (isGatedFeedItem(item)) {
            return <GatedExhibit key={item.id} item={item} rank={rank} />;
          }
          return (
            <StoryExhibit
              key={item.id}
              story={item}
              rank={rank}
              isActive={item.id === activeId}
              onSelect={onSelect}
            />
          );
        })}
      </div>

      <div ref={sentinelRef} className="h-8" />

      {isFetchingNextPage && (
        <p className="py-3 text-center font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">
          Loading more signals…
        </p>
      )}

      {!hasNextPage && items.length > 0 && (
        <div className="flex items-center justify-center gap-3 py-4 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">
          <span className="h-px w-8 bg-line" aria-hidden />
          End of briefing
          <span className="h-px w-8 bg-line" aria-hidden />
        </div>
      )}
    </section>
  );
}
