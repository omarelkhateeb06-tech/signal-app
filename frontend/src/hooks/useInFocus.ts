"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { getInFocusRequest, type InFocusTopic } from "@/lib/api";

// "In Focus" topic chips. Topics shift slowly (they aggregate over a 14-day
// window), so a generous staleTime avoids refetching on every feed mount.
export function useInFocus(
  options: { enabled?: boolean } = {},
): UseQueryResult<InFocusTopic[], Error> {
  return useQuery({
    queryKey: ["in-focus"],
    queryFn: getInFocusRequest,
    enabled: options.enabled ?? true,
    staleTime: 5 * 60 * 1000,
  });
}
