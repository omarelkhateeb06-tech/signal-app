"use client";

import { useInfiniteQuery, type UseInfiniteQueryResult } from "@tanstack/react-query";
import { getFeedRequest } from "@/lib/api";
import type { FeedResponse } from "@/types/story";

const PAGE_SIZE = 10;

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
