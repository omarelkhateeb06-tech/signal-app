"use client";

import { useEffect, useState, type RefObject } from "react";
import { SectorFilter } from "@/components/feed/SectorFilter";
import { isConnectionStory, deriveCardType } from "@/lib/feedCardType";
import { isGatedFeedItem, type FeedItem, type Story } from "@/types/story";
import { ConnectionHero } from "./ConnectionHero";
import { FeatureExhibit, GatedExhibit, StoryExhibit } from "./StoryExhibit";

// Left panel: the ranked stream — a scannable, type-aware index. The flagship
// THE CONNECTION is promoted to a full-width hero at the top; a second
// image-led story is promoted to a mid-stream feature so the scroll crests
// twice instead of flat-lining; everything else renders as a type-aware row.

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
  /** Reader role, woven into the locked personalized-read teaser. */
  roleLabel?: string | null;
}

/** A story qualifies for the second-peak feature when it carries real art. */
function hasArt(item: FeedItem): item is Story & { gated: false } {
  return (
    !isGatedFeedItem(item) &&
    Boolean(item.illustration_url ?? item.image_url)
  );
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
  roleLabel,
}: RankedStreamProps): JSX.Element {
  // Client clock for freshness badges — null on the server / first paint so
  // SSR and hydration agree, then set once mounted (no hydration mismatch).
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    setNowMs(Date.now());
  }, []);

  // The highest-ranked cross-sector chain becomes the full-width hero.
  const heroIndex = items.findIndex(
    (item) => !isGatedFeedItem(item) && isConnectionStory(item),
  );
  const heroItem = heroIndex >= 0 ? items[heroIndex] : null;

  // Second peak: the first image-bearing story at least four rows down that
  // isn't the hero and isn't itself a connection — an image-led FeatureExhibit
  // mid-stream. Anchored at a depth where the scroll would otherwise flatten.
  const featureIndex = items.findIndex(
    (item, i) =>
      i !== heroIndex &&
      i >= 4 &&
      hasArt(item) &&
      deriveCardType(item).type !== "connection",
  );

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
          if (i === featureIndex) {
            return (
              <FeatureExhibit
                key={item.id}
                story={item}
                rank={rank}
                isActive={item.id === activeId}
                onSelect={onSelect}
                roleLabel={roleLabel}
                nowMs={nowMs}
              />
            );
          }
          return (
            <StoryExhibit
              key={item.id}
              story={item}
              rank={rank}
              isActive={item.id === activeId}
              onSelect={onSelect}
              roleLabel={roleLabel}
              nowMs={nowMs}
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
