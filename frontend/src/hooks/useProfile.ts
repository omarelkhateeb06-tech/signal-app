"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getMyProfileRequest,
  postOnboardingCompleteRequest,
  postOnboardingEventsRequest,
  updateMyProfileRequest,
  type MyProfileResponse,
  type OnboardingCompleteInput,
  type OnboardingEventInput,
  type UpdateProfileInput,
} from "@/lib/api";
import type { UserProfile } from "@/types/auth";
import { useAuth } from "./useAuth";

// Single cache entry for "who am I" — the (app) shell, the
// useRequireOnboarded guard, and settings all share this key so they
// hit the API at most once per mount. Invalidate after
// `postOnboardingCompleteRequest` to flip onboarding_completed to true
// without a round-trip.
export const PROFILE_QUERY_KEY = ["me", "profile"] as const;

export function useProfile(): ReturnType<typeof useQuery<MyProfileResponse>> {
  const { isAuthenticated, hasHydrated } = useAuth();
  return useQuery<MyProfileResponse>({
    queryKey: PROFILE_QUERY_KEY,
    queryFn: getMyProfileRequest,
    // Defer until auth store has hydrated AND we have a session — a
    // pre-auth hit would 401 and bounce us back to /login via the
    // interceptor in api.ts, killing the signup→onboarding flow.
    enabled: hasHydrated && isAuthenticated,
    staleTime: 30_000,
  });
}

export function useOnboardingComplete(): ReturnType<
  typeof useMutation<
    { completed_at: string },
    Error,
    OnboardingCompleteInput
  >
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: postOnboardingCompleteRequest,
    // IMPORTANT: await the invalidation-and-refetch. Returning a
    // Promise from onSuccess makes `mutateAsync` wait on it, so by
    // the time the caller's `await complete.mutateAsync(...)` resolves
    // the cache holds the fresh profile with `onboarding_completed:
    // true`. Without the await, `router.push("/feed")` fires before
    // the refetch settles and the (app)/layout's useRequireOnboarded
    // bounces back to /onboarding/1 on stale cache. (Issue #5.)
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: PROFILE_QUERY_KEY });
    },
  });
}

export function useOnboardingEvents(): ReturnType<
  typeof useMutation<{ accepted: number }, Error, OnboardingEventInput[]>
> {
  return useMutation({
    mutationFn: postOnboardingEventsRequest,
  });
}

/**
 * Settings-page "Save interests" flow. Same invalidation pattern as
 * useOnboardingComplete — after the PUT, refetch /users/me/profile so
 * the cached view of the profile matches the DB. Without this, the
 * (app) layout's useRequireOnboarded keeps reading the stale cache and
 * (if completed_at was previously null and has just been set elsewhere)
 * can bounce back to /onboarding/1 after a perfectly successful save.
 *
 * Also invalidates the feed and per-story commentary caches because a
 * Settings save can change anything that affects ranking or commentary
 * generation (sectors, role, domain, seniority, depth, topics, goals).
 * Without this, navigating back to the feed after a Settings save shows
 * the pre-save copy until the next foreground refetch — which is the
 * "no in-app affordance for 'my settings changed'" UX gap reported by
 * users. ["feed"] and ["commentary"] are TanStack prefix matches so
 * every variant (per-sector, per-story, per-depth) is invalidated in
 * one call.
 */
export function useUpdateMyProfile(): ReturnType<
  typeof useMutation<UserProfile, Error, UpdateProfileInput>
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateMyProfileRequest,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: PROFILE_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ["feed"] }),
        queryClient.invalidateQueries({ queryKey: ["commentary"] }),
      ]);
    },
  });
}
