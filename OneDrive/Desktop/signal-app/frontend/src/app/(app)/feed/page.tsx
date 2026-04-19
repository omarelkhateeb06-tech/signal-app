"use client";

import { useEffect, useRef, useState } from "react";
import { useStories } from "@/hooks/useStories";
import { StoryCard } from "@/components/stories/StoryCard";
import { SectorFilter } from "@/components/feed/SectorFilter";
import { extractApiError } from "@/lib/api";

export default function FeedPage(): JSX.Element {
  const [sectors, setSectors] = useState<string[]>([]);
  const {
    data,
    error,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useStories({ sectors });

  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const stories = data?.pages.flatMap((p) => p.stories) ?? [];
  const total = data?.pages[0]?.total ?? 0;

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Your feed</h1>
        <SectorFilter selected={sectors} onChange={setSectors} />
        {!isLoading && (
          <p className="text-xs text-slate-500">
            {total} {total === 1 ? "story" : "stories"}
          </p>
        )}
      </header>

      {isLoading && (
        <div className="py-12 text-center text-sm text-slate-500">Loading stories…</div>
      )}

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          {extractApiError(error, "Failed to load feed.")}
        </div>
      )}

      {!isLoading && !error && stories.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-500">
          No stories yet. Try adjusting your sectors.
        </div>
      )}

      <div className="space-y-4">
        {stories.map((story) => (
          <StoryCard key={story.id} story={story} />
        ))}
      </div>

      <div ref={sentinelRef} className="h-8" />

      {isFetchingNextPage && (
        <div className="py-4 text-center text-xs text-slate-500">Loading more…</div>
      )}

      {!hasNextPage && stories.length > 0 && (
        <div className="py-4 text-center text-xs text-slate-400">You&apos;re all caught up.</div>
      )}
    </div>
  );
}
