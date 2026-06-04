"use client";

import { useStories } from "@/hooks/useStories";
import { useProfile } from "@/hooks/useProfile";
import { useAuth } from "@/hooks/useAuth";
import { isGatedFeedItem, type Story } from "@/types/story";
import { SwissFeed } from "@/components/redesign/SwissFeed";

// Swiss + Vintage fusion feed — the parallel design at /feed-swiss,
// wired to the real SIGNAL data layer for head-to-head comparison with
// the current dark feed at /feed.
export default function FeedSwissPage(): JSX.Element {
  const { data, isLoading, isError } = useStories({ sectors: [] });
  const profileQuery = useProfile();
  const profile = profileQuery.data?.profile ?? null;
  const { user } = useAuth();

  const stories = (data?.pages ?? [])
    .flatMap((p) => p.stories)
    .filter((item) => !isGatedFeedItem(item)) as Story[];

  if (isLoading) {
    return (
      <div className="theme-swiss flex min-h-dvh items-center justify-center bg-bg text-ink-muted">
        <p className="font-mono text-sm uppercase tracking-[0.16em]">
          Preparing your briefing…
        </p>
      </div>
    );
  }

  if (isError || stories.length === 0) {
    return (
      <div className="theme-swiss flex min-h-dvh items-center justify-center bg-bg text-ink-muted">
        <p className="font-mono text-sm uppercase tracking-[0.16em]">
          No intelligence to show.
        </p>
      </div>
    );
  }

  return (
    <SwissFeed
      stories={stories}
      profile={
        profile
          ? {
              role: profile.role ?? undefined,
              sectors: profile.sectors ?? undefined,
              name: user?.name ?? undefined,
            }
          : null
      }
    />
  );
}
