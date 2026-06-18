"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { PanelRight, X } from "lucide-react";
import { useStories } from "@/hooks/useStories";
import { useProfile } from "@/hooks/useProfile";
import { useAuth } from "@/hooks/useAuth";
import { useTier } from "@/hooks/useTier";
import { extractApiError } from "@/lib/api";
import { trackEngagement, flushEngagement } from "@/lib/engagementTracker";
import { isGatedFeedItem, type FeedItem, type Story } from "@/types/story";
import { SwissMasthead } from "./SwissMasthead";
import { RankedStream } from "./RankedStream";
import { DetailPanel } from "./DetailPanel";

// Onboarding role slug → human label for the personalized-read teaser CTA.
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

// Design C — "Swiss Command Center". A two-panel editorial intelligence
// briefing on warm cream. Self-contained: it owns the feed query, sector
// filter, selected-story state, and infinite scroll, and re-skins its
// subtree via the `.theme-swiss` token wrapper. Reuses the existing data
// layer wholesale (useStories / useProfile / useStoryCommentary) — no new
// endpoints, no backend changes.
//
// Responsive: ≥lg the detail panel is a sticky right column (scan left,
// read right). Below lg the right column collapses to a slide-over drawer
// (advisory-board responsive item) — the ranked stream goes full-width and
// the detail opens over it when a story is selected, or via the floating
// "Briefing" trigger for the profile / market view.

export function SwissCommandFeed(): JSX.Element {
  const [sectors, setSectors] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const { data, error, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } =
    useStories({ sectors });

  const profileQuery = useProfile();
  const profile = profileQuery.data?.profile ?? null;
  const { user } = useAuth();

  // Humanized role for the locked personalized-read teaser CTA ("Your read as
  // a Venture investor"). Derived from the stored onboarding role slug.
  const roleLabel = profile?.role
    ? ROLE_LABELS[profile.role] ?? profile.role
    : null;

  // The blurred personalized-read teaser is a free-tier conversion hook. Pro /
  // pro_trial readers get the real read via the lazy commentary path, so the
  // upsell is suppressed for them (and while the tier is still loading, to
  // avoid flashing it to a paying reader).
  const tierQuery = useTier();
  const showTeaser = tierQuery.data?.tier === "free";

  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const handleRefresh = (): void => {
    setIsRefreshing(true);
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["feed"] }),
      queryClient.invalidateQueries({ queryKey: ["commentary"] }),
    ]).finally(() => setIsRefreshing(false));
  };

  // Tracks the currently-open story + when it opened, so a story_view with
  // dwell time can be emitted when the reader moves on or leaves the feed.
  const viewRef = useRef<{ id: string; openedAt: number } | null>(null);

  // Selecting a story opens it on the right and opens the mobile drawer; on
  // ≥lg the drawer styles are inert (the panel is always visible) so that
  // part is a no-op. Also emits engagement telemetry (Phase 12o): a
  // click_through on each new selection, and a story_view (with dwell) for the
  // story being navigated away from.
  const handleSelect = (id: string): void => {
    const prev = viewRef.current;
    if (!prev || prev.id !== id) {
      if (prev) {
        trackEngagement({
          event_type: "story_view",
          event_id: prev.id,
          dwell_ms: Date.now() - prev.openedAt,
        });
      }
      trackEngagement({ event_type: "click_through", event_id: id });
      viewRef.current = { id, openedAt: Date.now() };
    }
    setSelectedId(id);
    setDrawerOpen(true);
  };

  // On unmount (leaving the feed), emit the final open story's dwell + flush.
  useEffect(() => {
    return () => {
      const v = viewRef.current;
      if (v) {
        trackEngagement({
          event_type: "story_view",
          event_id: v.id,
          dwell_ms: Date.now() - v.openedAt,
        });
        flushEngagement();
      }
    };
  }, []);

  // Lock body scroll while the drawer is open on a narrow viewport only.
  useEffect(() => {
    if (!drawerOpen) return;
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    if (!window.matchMedia("(max-width: 1023.98px)").matches) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [drawerOpen]);

  // The left ranked stream scrolls inside its own column now (fixed-height
  // dual-pane), so the infinite-scroll observer watches that container as
  // its root rather than the viewport.
  const leftScrollRef = useRef<HTMLDivElement | null>(null);
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
      { root: leftScrollRef.current, rootMargin: "600px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const items = useMemo<FeedItem[]>(
    () => data?.pages.flatMap((p) => p.stories) ?? [],
    [data],
  );

  const nonGated = useMemo(
    () => items.filter((i): i is Story & { gated: false } => !isGatedFeedItem(i)),
    [items],
  );

  // Single source of truth: `selectedId`. The left panel is a pure index;
  // it highlights the active row. The right panel reads the selected
  // story's detail, or the default profile sidebar when nothing is open.
  const selectedStory = useMemo<Story | null>(
    () => (selectedId ? nonGated.find((s) => s.id === selectedId) ?? null : null),
    [selectedId, nonGated],
  );
  const activeId = selectedStory ? selectedStory.id : null;

  // Top of the ranked feed — passed to the Through-Line synthesis.
  const topStoryIds = useMemo(
    () => nonGated.slice(0, 8).map((s) => s.id),
    [nonGated],
  );

  // Right panel: an in-flow column that scrolls within the fixed-height
  // region on ≥lg; a slide-over drawer below lg.
  const detailContainerClass = clsx(
    "min-w-0 bg-bg px-6 py-6 md:px-8",
    // mobile: fixed slide-over drawer
    "fixed inset-y-0 right-0 z-50 w-[88%] max-w-[440px] overflow-y-auto border-l border-line shadow-2xl transition-transform duration-300 ease-out",
    drawerOpen ? "translate-x-0" : "translate-x-full",
    // ≥lg: in-flow flex column that scrolls independently of the left
    "lg:static lg:z-auto lg:w-auto lg:max-w-none lg:flex-1 lg:translate-x-0 lg:min-h-0 lg:overflow-y-auto lg:border-l lg:shadow-none lg:transition-none",
  );

  const footer = (
    <footer className="border-t border-line px-6 py-5 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted md:px-8">
      © 2026 SIGNAL Intelligence
      <span className="mx-2 text-line">·</span>Terms
      <span className="mx-2 text-line">·</span>Privacy
    </footer>
  );

  // Everything below the fixed masthead. Loading / error / empty fill the
  // region; the success state is two independently-scrolling panels.
  const region = ((): JSX.Element => {
    if (isLoading) {
      return (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="grid grid-cols-1 gap-8 px-6 py-8 md:px-8 lg:grid-cols-[1.5fr_1fr]">
            <div className="space-y-4">
              <div className="skeleton h-4 w-40" />
              <div className="skeleton h-10 w-5/6" />
              <div className="skeleton h-24 w-full" />
              <div className="skeleton h-16 w-full" />
            </div>
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="skeleton h-12 w-full" />
              ))}
            </div>
          </div>
        </div>
      );
    }

    if (error) {
      return (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="m-6 border border-err/40 bg-err/5 p-4 text-sm text-err md:m-8">
            {extractApiError(error, "Failed to load briefing.")}
          </div>
        </div>
      );
    }

    if (items.length === 0) {
      return (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="m-6 border border-dashed border-line bg-bg p-12 text-center md:m-8">
            <p className="font-display text-xl text-ink">
              Your briefing is being prepared.
            </p>
            <p className="mt-1 text-sm text-ink-muted">
              Check back shortly — or adjust your sectors below.
            </p>
          </div>
          <RankedStream
            items={items}
            activeId={activeId}
            onSelect={handleSelect}
            sectors={sectors}
            onSectorsChange={setSectors}
            sentinelRef={sentinelRef}
            isFetchingNextPage={isFetchingNextPage}
            hasNextPage={Boolean(hasNextPage)}
            roleLabel={roleLabel}
            showTeaser={showTeaser}
          />
        </div>
      );
    }

    return (
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Left: ranked index — scrolls independently */}
        <div
          ref={leftScrollRef}
          className="min-h-0 min-w-0 flex-1 overflow-y-auto lg:flex-[1.5] lg:border-r lg:border-line"
        >
          <RankedStream
            items={items}
            activeId={activeId}
            onSelect={handleSelect}
            sectors={sectors}
            onSectorsChange={setSectors}
            sentinelRef={sentinelRef}
            isFetchingNextPage={isFetchingNextPage}
            hasNextPage={Boolean(hasNextPage)}
            roleLabel={roleLabel}
            showTeaser={showTeaser}
          />
          {footer}
        </div>

        {/* Right: detail / profile — scrolls independently (drawer on mobile) */}
        <div className={detailContainerClass}>
          <button
            type="button"
            onClick={() => setDrawerOpen(false)}
            className="mb-4 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted transition-colors hover:text-ink lg:hidden"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
            Close
          </button>
          <DetailPanel
            selectedStory={selectedStory}
            profile={profile}
            userName={user?.name ?? null}
            topStoryIds={topStoryIds}
            onBack={() => setSelectedId(null)}
          />
        </div>
      </div>
    );
  })();

  const hasStories = items.length > 0;

  // Fixed-height surface that fills the viewport below the 56px app header.
  // The page bg runs to the edges, but the briefing itself is held in a
  // centered, gutter-padded column so it breathes instead of going fully
  // edge-to-edge. The masthead is pinned; the two panels scroll on their own.
  return (
    <div className="theme-swiss h-[calc(100dvh_-_3.5rem)] overflow-hidden bg-bg text-ink">
      <div className="mx-auto flex h-full w-full max-w-[1840px] flex-col px-4 md:px-12 lg:px-20 2xl:px-32">
        <SwissMasthead
          preparedFor={user?.name ?? "Reader"}
          onRefresh={handleRefresh}
          isRefreshing={isRefreshing}
        />
        {region}
      </div>

      {/* Mobile drawer backdrop */}
      {hasStories && drawerOpen && (
        <div
          aria-hidden
          onClick={() => setDrawerOpen(false)}
          className="fixed inset-0 z-40 bg-black/30 lg:hidden"
        />
      )}

      {/* Mobile floating trigger — opens the detail/profile drawer */}
      {hasStories && !drawerOpen && (
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="fixed bottom-5 right-5 z-30 inline-flex items-center gap-2 border border-ink bg-surface px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-ink shadow-lg lg:hidden"
        >
          <PanelRight className="h-3.5 w-3.5" aria-hidden />
          Briefing
        </button>
      )}
    </div>
  );
}
