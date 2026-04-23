"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useRequireAuth } from "./useRequireAuth";
import { useProfile } from "./useProfile";

/**
 * Route guard for the authenticated app shell. Wraps `useRequireAuth`
 * and additionally redirects anyone whose profile does NOT have
 * `onboarding_completed === true` to `/onboarding/1`.
 *
 * Returns `{ ready }`:
 * - `ready === true` means: signed in AND onboarding complete; render
 *   the protected page.
 * - `ready === false` means: still loading, or we're about to redirect.
 *
 * Defense-in-depth only — the backend enforces the same invariant via
 * `requireProfile` on feed routes. This hook makes the redirect happen
 * before the user sees a transient error toast.
 */
export function useRequireOnboarded(
  redirectTo = "/onboarding/1",
): { ready: boolean } {
  const { ready: authReady } = useRequireAuth();
  const { data, isLoading, isFetching, isFetched } = useProfile();
  const router = useRouter();

  const onboardingCompleted = data?.onboarding_completed ?? false;

  useEffect(() => {
    if (!authReady) return;
    if (isLoading) return;
    if (!isFetched) return;
    // Don't bounce while a refetch is in flight — e.g. right after
    // `useOnboardingComplete` invalidates PROFILE_QUERY_KEY, the old
    // cached value is `false` until the refetch settles. Reading
    // before that would send the user back to /onboarding/1 a beat
    // after they successfully completed onboarding. (Issue #5.)
    if (isFetching) return;
    if (!onboardingCompleted) {
      router.replace(redirectTo);
    }
  }, [authReady, isLoading, isFetching, isFetched, onboardingCompleted, redirectTo, router]);

  return {
    ready: authReady && isFetched && !isFetching && onboardingCompleted,
  };
}
