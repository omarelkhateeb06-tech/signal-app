"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { motion } from "framer-motion";
import { useStories } from "@/hooks/useStories";
import { useTeams } from "@/hooks/useTeams";
import { useTeamsStore } from "@/store/teamsStore";
import { useProfile } from "@/hooks/useProfile";
import { StoryCard } from "@/components/stories/StoryCard";
import { GatedStoryCard } from "@/components/stories/GatedStoryCard";
import { FeedLead } from "@/components/feed/FeedLead";
import { FeedRailItem } from "@/components/feed/FeedRailItem";
import { SectorFilter } from "@/components/feed/SectorFilter";
import { SpotlightBand } from "@/components/feed/SpotlightBand";
import { ResearchReadBand } from "@/components/feed/ResearchReadBand";
import { SectorBadge } from "@/components/stories/SectorBadge";
import { extractApiError } from "@/lib/api";
import { isGatedFeedItem, type FeedItem, type Story } from "@/types/story";

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
  manager: "Manager",
  student: "Student",
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
      { rootMargin: "600px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const items = useMemo<FeedItem[]>(
    () => data?.pages.flatMap((p) => p.stories) ?? [],
    [data],
  );

  // Front-page composition (Phase 12z) — re-centered on RANK + personalization
  // after the advisory board flagged sector-partitioning as fighting the
  // "the few that matter, for you" promise. The feed stays in ranked order;
  // a few conditional editorial moments sit on top, then one ranked river:
  //   1. LEAD package — top non-gated story (preferring a real hero image)
  //      + a numbered "Top stories" rail.
  //   2. DEVELOPING — the first multi-source (widely-covered) story, as a
  //      wide image-led band (only when one exists).
  //   3. VALO ORIGINALS — native editorial synthesis, its own band (only
  //      when native posts exist).
  //   4. RIVER — everything else, in RANK ORDER, as one grid (sector shown
  //      as the card tag; the filter pills above slice by sector on demand).
  //      Gated soft-blocks only ever appear here.
  const { lead, rail, spotlight, research, river } = useMemo(() => {
    const nonGated = items.filter((i): i is Story & { gated: false } =>
      !isGatedFeedItem(i),
    );
    const leadStory =
      nonGated.slice(0, 5).find((s) => s.image_url) ?? nonGated[0] ?? null;
    const railStories = leadStory
      ? nonGated.filter((s) => s.id !== leadStory.id).slice(0, 5)
      : [];
    const used = new Set<string>(
      [leadStory, ...railStories].filter(Boolean).map((s) => (s as Story).id),
    );

    const remaining = nonGated.filter((s) => !used.has(s.id));
    const spot = remaining.find((s) => s.sources.length > 1) ?? null;
    if (spot) used.add(spot.id);

    // VALO Originals (native editorial synthesis) get their own band.
    const researchItems = nonGated
      .filter((s) => !used.has(s.id) && s.kind === "native")
      .slice(0, 4);
    researchItems.forEach((s) => used.add(s.id));

    // Everything else flows into one ranked river (order preserved).
    const riverItems = items.filter((i) => !used.has(i.id));
    return {
      lead: leadStory,
      rail: railStories,
      spotlight: spot,
      research: researchItems,
      river: riverItems,
    };
  }, [items]);

  // Stagger the river only on the first load; later infinite-scroll
  // batches mount without entrance animation.
  const initialRiverRef = useRef<number | null>(null);
  useEffect(() => {
    if (initialRiverRef.current === null && river.length > 0 && !isLoading) {
      initialRiverRef.current = river.length;
    }
  }, [river.length, isLoading]);

  const date = useMemo(() => todayLabel(), []);
  const roleLabel = profile?.role ? ROLE_LABELS[profile.role] ?? profile.role : null;
  const userSectors = profile?.sectors ?? [];

  return (
    <div className="space-y-10 pb-16 pt-2">
      {/* ===== Masthead (newspaper nameplate) ===== */}
      <header className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b-2 border-line pb-4">
          <div>
            <h1 className="font-display text-[26px] font-semibold leading-none tracking-tight text-ink md:text-[30px]">
              Your Briefing
            </h1>
            <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-muted">
              {date}
              {roleLabel ? ` · ${roleLabel}` : ""}
              {" · "}
              <span className="text-ink">Ranked for you</span>
            </p>
          </div>
          <div className="flex items-center gap-3 pb-0.5">
            {userSectors.length > 0 && (
              <div className="hidden items-center gap-1.5 sm:flex">
                {userSectors.map((s) => (
                  <SectorBadge key={s} sector={s} />
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isFetchingFeed}
              aria-label="Refresh feed"
              className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-md border border-line bg-surface text-ink-muted transition-colors hover:border-ink-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw
                className={`h-4 w-4 ${isFetchingFeed ? "animate-spin" : ""}`}
                aria-hidden
              />
            </button>
          </div>
        </div>

        <SectorFilter selected={sectors} onChange={setSectors} />
      </header>

      {/* ===== Loading skeleton ===== */}
      {isLoading && (
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1.7fr_1fr]">
          <div className="space-y-4">
            <div className="skeleton aspect-[16/9] w-full rounded-lg" />
            <div className="skeleton h-10 w-5/6 rounded" />
            <div className="skeleton h-16 w-full rounded" />
          </div>
          <div className="space-y-5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skeleton h-20 w-full rounded" />
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-err/40 bg-err/5 p-4 text-sm text-err">
          {extractApiError(error, "Failed to load feed.")}
        </div>
      )}

      {!isLoading && !error && items.length === 0 && (
        <div className="rounded-lg border border-dashed border-line bg-surface p-12 text-center">
          <p className="font-display text-xl text-ink">
            Your briefing is being prepared.
          </p>
          <p className="mt-1 text-sm text-ink-muted">
            Check back shortly — or adjust your sectors above.
          </p>
        </div>
      )}

      {/* ===== Lead + rail ===== */}
      {lead && (
        <section className="grid grid-cols-1 gap-8 lg:grid-cols-[1.7fr_1fr] lg:gap-12">
          <div className="min-w-0">
            <FeedLead story={lead} />
          </div>

          {rail.length > 0 && (
            <aside className="min-w-0 lg:border-l lg:border-line lg:pl-8">
              <div className="mb-1 flex items-center gap-2">
                <span aria-hidden className="h-2 w-2 flex-none rounded-[2px] bg-accent" />
                <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-ink">
                  Top stories
                </h2>
              </div>
              <motion.div
                className="divide-y divide-line"
                variants={{
                  hidden: {},
                  visible: { transition: { staggerChildren: 0.07, delayChildren: 0.15 } },
                }}
                initial="hidden"
                animate="visible"
              >
                {rail.map((story, i) => (
                  <FeedRailItem key={story.id} story={story} rank={i + 2} animated />
                ))}
              </motion.div>
            </aside>
          )}
        </section>
      )}

      {/* ===== Developing spotlight ===== */}
      {spotlight && <SpotlightBand story={spotlight} />}

      {/* ===== VALO Originals (native editorial) ===== */}
      {research.length > 0 && <ResearchReadBand stories={research} />}

      {/* ===== The ranked river — everything else, in order ===== */}
      {river.length > 0 && (
        <section className="space-y-5">
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="h-2 w-2 flex-none rounded-[2px] bg-accent"
            />
            <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-ink">
              Ranked feed
            </h2>
            <span className="h-px flex-1 bg-line" aria-hidden />
          </div>

          <motion.div
            className="grid grid-cols-1 items-start gap-5 md:grid-cols-2 md:gap-6 xl:grid-cols-3"
            variants={{
              hidden: {},
              visible: { transition: { staggerChildren: 0.06 } },
            }}
            initial="hidden"
            animate="visible"
          >
            {river.map((item, i) => {
              const initialCount = initialRiverRef.current ?? river.length;
              const animated = i < initialCount;
              return isGatedFeedItem(item) ? (
                <GatedStoryCard key={item.id} story={item} index={i} animated={animated} />
              ) : (
                <StoryCard key={item.id} story={item} index={i} animated={animated} />
              );
            })}
          </motion.div>
        </section>
      )}

      <div ref={sentinelRef} className="h-8" />

      {isFetchingNextPage && (
        <div className="py-4 text-center font-mono text-[11px] uppercase tracking-wide text-ink-muted">
          Loading more stories…
        </div>
      )}

      {!hasNextPage && items.length > 0 && (
        <div className="flex items-center justify-center gap-3 py-6 font-mono text-[11px] uppercase tracking-wide text-ink-muted">
          <span className="h-px w-8 bg-line" aria-hidden />
          You&apos;re all caught up
          <span className="h-px w-8 bg-line" aria-hidden />
        </div>
      )}
    </div>
  );
}
