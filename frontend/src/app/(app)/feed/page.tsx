"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useStories } from "@/hooks/useStories";
import { useTeams } from "@/hooks/useTeams";
import { useTeamsStore } from "@/store/teamsStore";
import { StoryCard } from "@/components/stories/StoryCard";
import { SectorFilter } from "@/components/feed/SectorFilter";
import { extractApiError } from "@/lib/api";

export default function FeedPage(): JSX.Element {
  const router = useRouter();
  const activeTeamId = useTeamsStore((s) => s.activeTeamId);
  const hasHydrated = useTeamsStore((s) => s.hasHydrated);
  const setActiveTeam = useTeamsStore((s) => s.setActiveTeam);
  const { data: teams } = useTeams({ enabled: hasHydrated && Boolean(activeTeamId) });

  useEffect(() => {
    if (!hasHydrated || !activeTeamId) return;
    if (teams === undefined) return;
    const match = teams.find((t) => t.id === activeTeamId);
    if (!match) {
      setActiveTeam(null);
      return;
    }
    router.replace(`/teams/${activeTeamId}`);
  }, [hasHydrated, activeTeamId, teams, router, setActiveTeam]);

  const [sectors, setSectors] = useState<string[]>([]);
  const {
    data,
    error,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useStories({ sectors });

  const queryClient = useQueryClient();
  // Prefix-match: any in-flight ["feed", …] query — including the
  // initial load, sector-switch refetches, and the manual invalidation
  // below — keeps the icon spinning.
  const isFetchingFeed = useIsFetching({ queryKey: ["feed"] }) > 0;
  const handleRefresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ["feed"] });
    void queryClient.invalidateQueries({ queryKey: ["commentary"] });
  };

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
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Your feed</h1>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isFetchingFeed}
            aria-label="Refresh feed"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border bg-white text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw
              className={`h-4 w-4 ${isFetchingFeed ? "animate-spin" : ""}`}
              aria-hidden
            />
          </button>
        </div>
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
