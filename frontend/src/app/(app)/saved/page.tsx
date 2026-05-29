"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useSavedStories } from "@/hooks/useSavedStories";
import { StoryCard } from "@/components/stories/StoryCard";
import { SectorFilter } from "@/components/feed/SectorFilter";
import { Button } from "@/components/ui/Button";
import { extractApiError } from "@/lib/api";
import type { SavedStory } from "@/types/story";

const RIVER_STAGGER = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06 } },
};

type SortMode = "saved_at" | "published_at";

export default function SavedPage(): JSX.Element {
  const [sectors, setSectors] = useState<string[]>([]);
  const [sort, setSort] = useState<SortMode>("saved_at");
  const {
    data,
    error,
    isLoading,
    fetchNextPage,
    isFetchingNextPage,
    hasNextPage,
  } = useSavedStories();

  const stories = useMemo(() => {
    const all: SavedStory[] = data?.pages.flatMap((p) => p.stories) ?? [];
    const filtered =
      sectors.length === 0
        ? all
        : all.filter((s) => sectors.includes(s.sector as string));
    const sorted = [...filtered].sort((a, b) => {
      if (sort === "saved_at") {
        return (
          new Date(b.saved_at).getTime() - new Date(a.saved_at).getTime()
        );
      }
      const aDate = a.published_at ?? a.created_at;
      const bDate = b.published_at ?? b.created_at;
      return new Date(bDate).getTime() - new Date(aDate).getTime();
    });
    return sorted;
  }, [data, sectors, sort]);

  const total = data?.pages[0]?.total ?? 0;

  return (
    <div className="space-y-8 pb-12 pt-2">
      <header className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b-2 border-line pb-4">
          <div>
            <h1 className="font-display text-[26px] font-semibold leading-none tracking-tight text-ink md:text-[30px]">
              Saved
            </h1>
            {!isLoading && (
              <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-muted">
                {total} saved {total === 1 ? "story" : "stories"}
              </p>
            )}
          </div>
        </div>
        <SectorFilter selected={sectors} onChange={setSectors} />
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-ink-muted">Sort by:</span>
          {(
            [
              { value: "saved_at", label: "Date saved" },
              { value: "published_at", label: "Date published" },
            ] as const
          ).map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setSort(option.value)}
              className={[
                "rounded-pill border px-3 py-1 font-medium transition-colors",
                sort === option.value
                  ? "border-ink bg-ink text-bg"
                  : "border-line bg-surface text-ink-muted hover:border-ink-muted hover:text-ink",
              ].join(" ")}
            >
              {option.label}
            </button>
          ))}
        </div>
      </header>

      {isLoading && (
        <div className="py-12 text-center text-sm text-ink-muted">Loading…</div>
      )}

      {error && (
        <div className="rounded-md border border-err/40 bg-err/5 p-4 text-sm text-err">
          {extractApiError(error, "Failed to load saved stories.")}
        </div>
      )}

      {!isLoading && !error && stories.length === 0 && (
        <div className="rounded-md border border-dashed border-line bg-surface p-12 text-center">
          <p className="font-display text-lg text-ink">
            {total === 0
              ? "No saved stories yet."
              : "No saved stories match the current filters."}
          </p>
          {total === 0 && (
            <p className="mt-1 text-sm text-ink-muted">
              Tap the bookmark icon on any story to save it here.
            </p>
          )}
        </div>
      )}

      <motion.div
        className="grid grid-cols-1 gap-5 md:grid-cols-2 md:gap-6"
        variants={RIVER_STAGGER}
        initial="hidden"
        animate="visible"
      >
        {stories.map((story, i) => (
          <StoryCard key={story.id} story={story} index={i} animated />
        ))}
      </motion.div>

      {hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </div>
  );
}
