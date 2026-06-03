"use client";

import { useInfiniteQuery, type UseInfiniteQueryResult } from "@tanstack/react-query";
import { getFeedRequest } from "@/lib/api";
import type { FeedResponse } from "@/types/story";

// Feed page sizes. The page param carries both offset and limit so the
// first page and subsequent "load more" pages can fetch different counts.
//
// The front-page composition consumes a fixed 5 stories off the TOP of the
// feed (1 lead + 4 rail); everything after flows into the 2-column "More in
// your sectors" river grid. To keep that grid in complete rows of two:
//   - first page fetches 11 → 5 consumed by lead+rail, 6 land in the river.
//   - every later page fetches 6 → all 6 go straight to the river (lead and
//     rail are already populated), so each load adds exactly three rows.
// A flat size (e.g. 11 everywhere) would add 11 river cards per load — an
// odd count that re-introduces the orphaned final card on every page.
const FIRST_PAGE_SIZE = 11;
const NEXT_PAGE_SIZE = 6;

interface FeedPageParam {
  offset: number;
  limit: number;
}

interface UseStoriesOptions {
  sectors?: string[];
  enabled?: boolean;
}

export function useStories(
  options: UseStoriesOptions = {},
): UseInfiniteQueryResult<
  { pages: FeedResponse[]; pageParams: FeedPageParam[] },
  Error
> {
  const sectors = options.sectors ?? [];
  return useInfiniteQuery({
    queryKey: ["feed", sectors],
    initialPageParam: { offset: 0, limit: FIRST_PAGE_SIZE } as FeedPageParam,
    queryFn: ({ pageParam }) =>
      getFeedRequest({
        sectors,
        limit: pageParam.limit,
        offset: pageParam.offset,
      }),
    getNextPageParam: (last) =>
      last.has_more
        ? { offset: last.offset + last.limit, limit: NEXT_PAGE_SIZE }
        : undefined,
    enabled: options.enabled ?? true,
  });
}
