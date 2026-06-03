"use client";

import { useInfiniteQuery, type UseInfiniteQueryResult } from "@tanstack/react-query";
import { getFeedRequest } from "@/lib/api";
import type { FeedResponse } from "@/types/story";

// Feed page size. The front-page composition consumes a fixed 5 stories
// off the top of each fetched page (1 lead + 4 rail) before the rest flow
// into the 2-column "More in your sectors" river. 11 therefore yields 6
// river cards on the first page — three complete rows instead of the
// orphaned 2½ that a size of 10 produced. Infinite scroll is unaffected
// (getNextPageParam keys off has_more + offset/limit, not this value).
const PAGE_SIZE = 11;

interface UseStoriesOptions {
  sectors?: string[];
  enabled?: boolean;
}

export function useStories(
  options: UseStoriesOptions = {},
): UseInfiniteQueryResult<{ pages: FeedResponse[]; pageParams: number[] }, Error> {
  const sectors = options.sectors ?? [];
  return useInfiniteQuery({
    queryKey: ["feed", sectors],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      getFeedRequest({
        sectors,
        limit: PAGE_SIZE,
        offset: typeof pageParam === "number" ? pageParam : 0,
      }),
    getNextPageParam: (last) => (last.has_more ? last.offset + last.limit : undefined),
    enabled: options.enabled ?? true,
  });
}
