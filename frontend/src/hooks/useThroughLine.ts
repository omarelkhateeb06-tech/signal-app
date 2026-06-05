"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { getThroughLineRequest, type ThroughLineResponse } from "@/lib/api";

// "The Through-Line" — the day's editorial synthesis for the default
// right-panel state. The server caches per (user, profile_version, UTC
// day), so the client keys on the top story ids (stable within a day,
// ranking order preserved) and holds the result with a long staleTime.
// Only the top 8 ids are sent — the synthesis is over the headline set.

export function useThroughLine(
  storyIds: string[],
  options: { enabled?: boolean } = {},
): UseQueryResult<ThroughLineResponse, Error> {
  const top = storyIds.slice(0, 8);
  const enabled = (options.enabled ?? true) && top.length > 0;
  return useQuery({
    queryKey: ["through-line", top.join(",")],
    queryFn: () => getThroughLineRequest(top),
    enabled,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: 1,
  });
}
