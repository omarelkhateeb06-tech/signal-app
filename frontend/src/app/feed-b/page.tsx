"use client";

import { useStories } from "@/hooks/useStories";
import { isGatedFeedItem, type Story } from "@/types/story";
import {
  TerminalFeed,
  TerminalFeedSkeleton,
} from "@/components/redesign/TerminalFeed";

// Design B — "The Terminal" feed, built ground-up in parallel with the
// Design A feed (app/(app)/feed). Standalone route so Design A is wholly
// untouched; reuses the same data layer (useStories) so the comparison is
// apples-to-apples on design, not data. Audited head-to-head against A.
export default function FeedBPage(): JSX.Element {
  const { data, isLoading, isError } = useStories({ sectors: [] });

  const stories = (data?.pages ?? [])
    .flatMap((p) => p.stories)
    .filter((item) => !isGatedFeedItem(item)) as Story[];

  if (isLoading) {
    return <TerminalFeedSkeleton />;
  }

  if (isError || stories.length === 0) {
    return (
      <div className="theme-terminal flex min-h-dvh items-center justify-center bg-bg text-ink-muted">
        <p className="font-mono text-sm uppercase tracking-[0.16em]">
          No signals to show.
        </p>
      </div>
    );
  }

  return <TerminalFeed stories={stories} />;
}
