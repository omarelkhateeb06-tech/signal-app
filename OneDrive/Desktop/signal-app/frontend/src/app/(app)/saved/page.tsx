"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import { useSavedStories } from "@/hooks/useSavedStories";
import { StoryCard } from "@/components/stories/StoryCard";
import { SectorFilter } from "@/components/feed/SectorFilter";
import { extractApiError } from "@/lib/api";
import type { SavedStory } from "@/types/story";

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
    <div className="space-y-6">
      <header className="space-y-3">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Saved</h1>
        <SectorFilter selected={sectors} onChange={setSectors} />
        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-500">Sort by:</span>
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
              className={clsx(
                "rounded-full border px-3 py-1 font-medium transition-colors",
                sort === option.value
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        {!isLoading && (
          <p className="text-xs text-slate-500">
            {total} saved {total === 1 ? "story" : "stories"}
          </p>
        )}
      </header>

      {isLoading && (
        <div className="py-12 text-center text-sm text-slate-500">Loading…</div>
      )}

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          {extractApiError(error, "Failed to load saved stories.")}
        </div>
      )}

      {!isLoading && !error && stories.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-500">
          {total === 0
            ? "You haven't saved any stories yet."
            : "No saved stories match the current filters."}
        </div>
      )}

      <div className="space-y-4">
        {stories.map((story) => (
          <StoryCard key={story.id} story={story} />
        ))}
      </div>

      {hasNextPage && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => void fetchNextPage()}
            disabled={isFetchingNextPage}
            className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {isFetchingNextPage ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}
