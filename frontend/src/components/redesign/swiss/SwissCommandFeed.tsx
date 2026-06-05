"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { PanelRight, X } from "lucide-react";
import { useStories } from "@/hooks/useStories";
import { useProfile } from "@/hooks/useProfile";
import { useAuth } from "@/hooks/useAuth";
import { extractApiError } from "@/lib/api";
import { isGatedFeedItem, type FeedItem, type Story } from "@/types/story";
import { SwissMasthead } from "./SwissMasthead";
import { RankedStream } from "./RankedStream";
import { DetailPanel } from "./DetailPanel";

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

  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const handleRefresh = (): void => {
    setIsRefreshing(true);
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["feed"] }),
      queryClient.invalidateQueries({ queryKey: ["commentary"] }),
    ]).finally(() => setIsRefreshing(false));
  };

  // Selecting a story opens the mobile drawer; on ≥lg the drawer styles are
  // inert (the panel is always visible) so this is a no-op there.
  const handleSelect = (id: string): void => {
    setSelectedId(id);
    setDrawerOpen(true);
  };

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

  // Mobile slide-over + desktop sticky column, one DetailPanel instance.
  const detailContainerClass = clsx(
    "min-w-0 bg-bg px-6 py-6 md:px-8",
    // mobile: fixed slide-over drawer
    "fixed inset-y-0 right-0 z-50 w-[88%] max-w-[440px] overflow-y-auto border-l border-line shadow-2xl transition-transform duration-300 ease-out",
    drawerOpen ? "translate-x-0" : "translate-x-full",
    // ≥lg: in-flow sticky column, no transform / shadow / fixed offsets
    "lg:sticky lg:inset-y-auto lg:right-auto lg:top-0 lg:z-auto lg:w-auto lg:max-w-none lg:translate-x-0 lg:max-h-screen lg:self-start lg:border-l lg:shadow-none lg:transition-none",
  );

  const body = ((): JSX.Element => {
    if (isLoading) {
      return (
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
      );
    }

    if (error) {
      return (
        <div className="m-6 border border-err/40 bg-err/5 p-4 text-sm text-err md:m-8">
          {extractApiError(error, "Failed to load briefing.")}
        </div>
      );
    }

    if (items.length === 0) {
      return (
        <div className="m-6 border border-dashed border-line bg-bg p-12 text-center md:m-8">
          <p className="font-display text-xl text-ink">
            Your briefing is being prepared.
          </p>
          <p className="mt-1 text-sm text-ink-muted">
            Check back shortly — or adjust your sectors below.
          </p>
          <div className="mt-6">
            <RankedStream
              items={items}
              activeId={activeId}
              onSelect={handleSelect}
              sectors={sectors}
              onSectorsChange={setSectors}
              sentinelRef={sentinelRef}
              isFetchingNextPage={isFetchingNextPage}
              hasNextPage={Boolean(hasNextPage)}
            />
          </div>
        </div>
      );
    }

    return (
      <div className="grid grid-cols-1 items-start lg:grid-cols-[1.5fr_1fr]">
        <div className="lg:border-r lg:border-line">
          <RankedStream
            items={items}
            activeId={activeId}
            onSelect={handleSelect}
            sectors={sectors}
            onSectorsChange={setSectors}
            sentinelRef={sentinelRef}
            isFetchingNextPage={isFetchingNextPage}
            hasNextPage={Boolean(hasNextPage)}
          />
        </div>
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
            onBack={() => setSelectedId(null)}
          />
        </div>
      </div>
    );
  })();

  const hasStories = items.length > 0;

  return (
    <div className="theme-swiss -mx-4 -my-8 min-h-screen bg-bg text-ink md:-mx-8">
      <div className="mx-auto max-w-[1600px]">
        <SwissMasthead
          preparedFor={user?.name ?? "Reader"}
          sectors={profile?.sectors ?? []}
          onRefresh={handleRefresh}
          isRefreshing={isRefreshing}
        />
        {body}
        <footer className="border-t border-line px-6 py-5 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted md:px-10">
          © 2026 SIGNAL Intelligence
          <span className="mx-2 text-line">·</span>Terms
          <span className="mx-2 text-line">·</span>Privacy
        </footer>
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
