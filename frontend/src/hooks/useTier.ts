"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { getMyTierRequest, type TierSnapshot } from "@/lib/api";

// Phase 12g — tier snapshot used by the trial badge and the depth
// toggle's free-tier lock. Server lazy-downgrades expired pro_trial
// → free in the same call, so consuming this hook is also the
// trigger for the downgrade transition.
//
// staleTime 60s: the only things that change the tier are trial
// expiry (lazy, server-side) and a manual upgrade (drives a refetch
// via invalidation in the upgrade flow — chunk 12h). 60s keeps the
// badge fresh without hammering the endpoint on every page nav.
export function useTier(): UseQueryResult<TierSnapshot, Error> {
  return useQuery({
    queryKey: ["me", "tier"],
    queryFn: getMyTierRequest,
    staleTime: 60_000,
    gcTime: 10 * 60_000,
  });
}
