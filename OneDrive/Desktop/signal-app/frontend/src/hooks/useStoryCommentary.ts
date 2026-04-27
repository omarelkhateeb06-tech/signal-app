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
import type { CommentaryResponse } from "@/types/story";

export type DepthOverride = "accessible" | "briefed" | "technical";

interface UseStoryCommentaryOptions {
  enabled?: boolean;
  depth?: DepthOverride;
}

export function useStoryCommentary(
  storyId: string,
  options: UseStoryCommentaryOptions = {},
): UseQueryResult<CommentaryResponse, Error> {
  const enabled = options.enabled ?? true;
  const depth = options.depth;

  return useQuery({
    // depth is part of the key so an explicit override maintains a
    // separate cache entry from the server-default-depth result.
    queryKey: ["commentary", storyId, depth ?? null],
    queryFn: () => withCommentarySlot(() => getStoryCommentaryRequest(storyId, depth)),
    enabled: Boolean(storyId) && enabled,
    staleTime: Infinity,
    gcTime: 10 * 60 * 1000, // 10 min — keep across feed⇄detail navigation
    retry: 1, // the server always returns a result (fallback tiers); one retry covers a transient network blip
  });
}
