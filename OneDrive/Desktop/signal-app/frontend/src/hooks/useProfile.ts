"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getMyProfileRequest,
  postOnboardingCompleteRequest,
  postOnboardingEventsRequest,
  type MyProfileResponse,
  type OnboardingCompleteInput,
  type OnboardingEventInput,
} from "@/lib/api";
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
    onSuccess: () => {
      // Bust the profile cache so the next read sees
      // onboarding_completed: true.
      void queryClient.invalidateQueries({ queryKey: PROFILE_QUERY_KEY });
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
