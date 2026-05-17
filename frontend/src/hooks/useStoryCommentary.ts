"use client";

// Phase 12c — lazy per-story commentary fetch, semaphore-gated.
//
// One useQuery per visible story. The `enabled` flag is driven by the
// feed's 5-story scroll-ahead window (see components/stories/StoryCard
// and app/(app)/feed/page for the visibility wiring). Even with
// enabled=true across many cards, withCommentarySlot caps parallel
// requests to COMMENTARY_MAX_CONCURRENT — queued fetches resolve in
// FIFO order as slots free up.
//
// Cache key includes `depth` so a Premium depth-selector flip
// (story detail) gets its own cache entry and a 404/error on the
// flipped depth doesn't poison the default-depth result.
//
// staleTime is Infinity: the server's own cache key bumps on profile
// changes (profile_version), so the client has no independent reason
// to revalidate commentary within a session. Navigating away and back
// reuses the cached result.

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { getStoryCommentaryRequest } from "@/lib/api";
import { withCommentarySlot } from "@/lib/commentaryQueue";
import type { CommentaryEnvelope } from "@/types/story";

export type DepthOverride = "accessible" | "briefed" | "technical";

interface UseStoryCommentaryOptions {
  enabled?: boolean;
  depth?: DepthOverride;
}

// Phase 12g — return type widened to CommentaryEnvelope so callers
// can branch on `gated` (depth-gate envelope for free users who
// request briefed/technical). Consumers that don't care about the
// gate path can read `data.commentary` directly; the gate envelope
// has no `commentary` field so the existing falsy-check fall-through
// still works.
export function useStoryCommentary(
  storyId: string,
  options: UseStoryCommentaryOptions = {},
): UseQueryResult<CommentaryEnvelope, Error> {
  const enabled = options.enabled ?? true;
  const depth = options.depth;

  return useQuery({
    queryKey: ["commentary", storyId, depth ?? null],
    queryFn: () => withCommentarySlot(() => getStoryCommentaryRequest(storyId, depth)),
    enabled: Boolean(storyId) && enabled,
    staleTime: Infinity,
    gcTime: 10 * 60 * 1000,
    retry: 1,
  });
}
