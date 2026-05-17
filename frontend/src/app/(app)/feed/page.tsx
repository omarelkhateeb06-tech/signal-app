"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useStories } from "@/hooks/useStories";
import { useTeams } from "@/hooks/useTeams";
import { useTeamsStore } from "@/store/teamsStore";
import { useProfile } from "@/hooks/useProfile";
import { StoryCard } from "@/components/stories/StoryCard";
import { GatedStoryCard } from "@/components/stories/GatedStoryCard";
import { SectorFilter } from "@/components/feed/SectorFilter";
import { SectorBadge } from "@/components/stories/SectorBadge";
import { extractApiError } from "@/lib/api";
import { isGatedFeedItem } from "@/types/story";

// Phase 12j — feed page. "Your Briefing" page header in serif
// display, a personalization meta line under it (role · sectors),
// today's date in mono, then the SectorFilter, then the feed.
//
// Skeleton state for initial load (warm shimmer), empty state with
// inviting copy, and the existing infinite-scroll sentinel.

const ROLE_LABELS: Record<string, string> = {
  founder: "Founder",
  engineer: "Engineer",
  investor: "Investor",
  vc: "Venture investor",
  analyst: "Analyst",
  researcher: "Researcher",
  operator: "Operator",
  product_manager: "Product manager",
  executive: "Executive",
};

function todayLabel(): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date());
}

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

  const profileQuery = useProfile();
  const profile = profileQuery.data?.profile ?? null;

  const queryClient = useQueryClient();
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
      { rootMargin: "400px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const stories = data?.pages.flatMap((p) => p.stories) ?? [];

  const date = useMemo(() => todayLabel(), []);
  const roleLabel = profile?.role ? ROLE_LABELS[profile.role] ?? profile.role : null;
  const userSectors = profile?.sectors ?? [];

  return (
    <div className="space-y-8 py-6">
      <header className="space-y-3">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="font-display text-[36px] font-semibold leading-tight tracking-tight text-ink">
            Your Briefing
          </h1>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isFetchingFeed}
            aria-label="Refresh feed"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-line bg-surface text-ink-muted transition-colors hover:border-ink-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw
              className={`h-4 w-4 ${isFetchingFeed ? "animate-spin" : ""}`}
              aria-hidden
            />
          </button>
        </div>
        {(roleLabel || userSectors.length > 0) && (
          <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            {roleLabel && <span>{roleLabel}</span>}
            {roleLabel && userSectors.length > 0 && (
              <span className="text-line">·</span>
            )}
            {userSectors.map((s) => (
              <SectorBadge key={s} sector={s} />
            ))}
          </div>
        )}
        <p className="font-mono text-[11px] uppercase tracking-wider text-ink-muted">
          {date}
        </p>
        <div className="pt-2">
          <SectorFilter selected={sectors} onChange={setSectors} />
        </div>
      </header>

      {isLoading && (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="skeleton h-44 rounded-md border border-line"
            />
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-md border border-err/40 bg-err/5 p-4 text-sm text-err">
          {extractApiError(error, "Failed to load feed.")}
        </div>
      )}

      {!isLoading && !error && stories.length === 0 && (
        <div className="rounded-md border border-dashed border-line bg-surface p-12 text-center">
          <p className="font-display text-lg text-ink">
            Your briefing is being prepared.
          </p>
          <p className="mt-1 text-sm text-ink-muted">
            Check back shortly — or adjust your sectors above.
          </p>
        </div>
      )}

      <div className="space-y-4">
        {stories.map((story, i) =>
          isGatedFeedItem(story) ? (
            <GatedStoryCard key={story.id} story={story} index={i} />
          ) : (
            <StoryCard key={story.id} story={story} index={i} />
          ),
        )}
      </div>

      <div ref={sentinelRef} className="h-8" />

      {isFetchingNextPage && (
        <div className="py-4 text-center text-xs text-ink-muted">
          Loading more stories…
        </div>
      )}

      {!hasNextPage && stories.length > 0 && (
        <div className="py-4 text-center text-xs text-ink-muted">
          You&apos;re all caught up.
        </div>
      )}
    </div>
  );
}
