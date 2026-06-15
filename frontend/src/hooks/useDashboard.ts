"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { getDashboardRequest, type DashboardData } from "@/lib/api";

export function useDashboard(
  options: { enabled?: boolean } = {},
): UseQueryResult<DashboardData, Error> {
  return useQuery({
    queryKey: ["dashboard"],
    queryFn: getDashboardRequest,
    enabled: options.enabled ?? true,
    staleTime: 5 * 60 * 1000,
  });
}
