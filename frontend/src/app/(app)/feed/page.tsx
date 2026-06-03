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
import { SectorSection } from "@/components/feed/SectorSection";
import { SectorTriptych } from "@/components/feed/SectorTriptych";
import { SectorMosaic } from "@/components/feed/SectorMosaic";
import { SpotlightBand } from "@/components/feed/SpotlightBand";
import { ResearchReadBand } from "@/components/feed/ResearchReadBand";
import { LatestStrip } from "@/components/feed/LatestStrip";
import { SectorBadge } from "@/components/stories/SectorBadge";
import type { SectionProps } from "@/components/feed/sectionShared";
import { extractApiError } from "@/lib/api";
import { isGatedFeedItem, type FeedItem, type Story } from "@/types/story";

// Each sector band uses a structurally DIFFERENT layout, cycled by
// position, so no two sections down the scroll share a shape (the
// Bloomberg "nothing repeats" feel): feature+list, then triptych, then
// big-feature+thumbnail-mosaic.
const SECTION_LAYOUTS: Array<(props: SectionProps) => JSX.Element | null> = [
  SectorSection,
  SectorTriptych,
  SectorMosaic,
];

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

  // Modular front-page composition (Phase 12y) — a briefing with rhythm,
  // not a uniform feed:
  //   1. LEAD package — a non-gated story (preferring one with a hero image)
  //      + a numbered "Top stories" rail.
  //   2. DEVELOPING spotlight — the first multi-source story left over gets
  //      its own wide, image-led band.
  //   3. SECTOR sections — remaining stories grouped by industry, each its
  //      own band (featured image card + supporting list), user's sectors
  //      first.
  //   4. TAIL river — anything left (incl. gated soft-blocks) flows into the
  //      2-column grid that powers infinite scroll.
  // Gated items never become lead/rail/spotlight/featured — they only ever
  // appear in the tail river.
  const { lead, rail, spotlight, research, sectorGroups, latest, river } = useMemo(() => {
    const sectorPref = profile?.sectors ?? [];
    const nonGated = items.filter((i): i is Story & { gated: false } =>
      !isGatedFeedItem(i),
    );
    const leadStory =
      nonGated.slice(0, 5).find((s) => s.image_url) ?? nonGated[0] ?? null;
    const railStories = leadStory
      ? nonGated.filter((s) => s.id !== leadStory.id).slice(0, 4)
      : [];
    const used = new Set<string>(
      [leadStory, ...railStories].filter(Boolean).map((s) => (s as Story).id),
    );

    const remaining = nonGated.filter((s) => !used.has(s.id));
    const spot = remaining.find((s) => s.sources.length > 1) ?? null;
    if (spot) used.add(spot.id);

    // VALO Originals (native editorial synthesis) get their own band.
    const research = nonGated
      .filter((s) => !used.has(s.id) && s.kind === "native")
      .slice(0, 4);
    research.forEach((s) => used.add(s.id));

    const SECTOR_ORDER = ["ai", "finance", "semiconductors"];
    const order = Array.from(new Set([...sectorPref, ...SECTOR_ORDER]));
    const afterSpot = nonGated.filter((s) => !used.has(s.id));
    const groups = order
      .map((sec) => ({
        sector: sec,
        stories: afterSpot.filter((s) => s.sector === sec).slice(0, 4),
      }))
      .filter((g) => g.stories.length > 0);
    // Float a story WITH a real image to the front of each section so the
    // big featured slot is a photo, not a fallback panel.
    const hasImage = (s: Story & { gated: false }): boolean =>
      Boolean(s.image_url || (s.kind === "native" && s.illustration_url));
    groups.forEach((g) => {
      const idx = g.stories.findIndex(hasImage);
      if (idx > 0) {
        const [withImg] = g.stories.splice(idx, 1);
        g.stories.unshift(withImg);
      }
    });
    groups.forEach((g) => g.stories.forEach((s) => used.add(s.id)));

    // "Latest" — the most-recent leftovers as a dense timestamped strip.
    const afterSectors = nonGated.filter((s) => !used.has(s.id));
    const latest = [...afterSectors]
      .sort(
        (a, b) =>
          new Date(b.published_at ?? b.created_at).getTime() -
          new Date(a.published_at ?? a.created_at).getTime(),
      )
      .slice(0, 9);
    latest.forEach((s) => used.add(s.id));

    const riverItems = items.filter((i) => !used.has(i.id));
    return {
      lead: leadStory,
      rail: railStories,
      spotlight: spot,
      research,
      sectorGroups: groups,
      latest,
      river: riverItems,
    };
  }, [items, profile?.sectors]);

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
  const storyCount = data?.pages?.[0]?.total ?? items.length;

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
              {storyCount > 0 ? (
                <>
                  {" · "}
                  <span className="text-ink">{storyCount} stories today</span>
                </>
              ) : null}
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

      {/* ===== Per-sector sections (alternating layout shapes) ===== */}
      {sectorGroups.map((g, i) => {
        const Layout = SECTION_LAYOUTS[i % SECTION_LAYOUTS.length];
        return <Layout key={g.sector} sector={g.sector} stories={g.stories} />;
      })}

      {/* ===== Latest (dense timestamped strip) ===== */}
      {latest.length > 0 && <LatestStrip stories={latest} />}

      {/* ===== Tail river (catch-all + infinite scroll) ===== */}
      {river.length > 0 && (
        <section className="space-y-5">
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="h-2 w-2 flex-none rounded-[2px] bg-accent"
            />
            <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-ink">
              More stories
            </h2>
            <span className="h-px flex-1 bg-line" aria-hidden />
          </div>

          <motion.div
            className="grid grid-cols-1 gap-5 md:grid-cols-2 md:gap-6 xl:grid-cols-3"
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
