"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { getStoryRequest, getRelatedStoriesRequest } from "@/lib/api";
import type { Story } from "@/types/story";

export function useStory(id: string | null): UseQueryResult<Story, Error> {
  return useQuery({
    queryKey: ["story", id],
    queryFn: () => getStoryRequest(id as string),
    enabled: Boolean(id),
  });
}

export function useRelatedStories(id: string | null): UseQueryResult<Story[], Error> {
  return useQuery({
    queryKey: ["story", id, "related"],
    queryFn: () => getRelatedStoriesRequest(id as string),
    enabled: Boolean(id),
  });
}
