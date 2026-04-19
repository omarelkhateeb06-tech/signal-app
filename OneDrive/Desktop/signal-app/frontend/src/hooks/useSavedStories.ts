"use client";

import {
  useInfiniteQuery,
  type UseInfiniteQueryResult,
} from "@tanstack/react-query";
import { getMySavesRequest } from "@/lib/api";
import type { SavedStoriesResponse } from "@/types/story";

const PAGE_SIZE = 20;

export function useSavedStories(): UseInfiniteQueryResult<
  { pages: SavedStoriesResponse[]; pageParams: number[] },
  Error
> {
  return useInfiniteQuery({
    queryKey: ["saves"],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      getMySavesRequest({
        limit: PAGE_SIZE,
        offset: typeof pageParam === "number" ? pageParam : 0,
      }),
    getNextPageParam: (last) => (last.has_more ? last.offset + last.limit : undefined),
  });
}
