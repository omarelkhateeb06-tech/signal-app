"use client";

import { useRequireAuth } from "@/hooks/useRequireAuth";
import { useProfile } from "@/hooks/useProfile";
import { useOnboardingAbandonBeacon } from "@/hooks/useOnboardingNav";

// The onboarding flow is gated on authentication only — NOT on
// onboarding completion (that would create a redirect loop). If a
// user with a completed profile lands here, the individual screens
// can optionally redirect them to /feed, but the layout itself stays
// neutral.
//
// Phase 12b/fix-it: the layout also owns the `onboarding_abandoned`
// beacon — one beforeunload listener covers every screen and detaches
// itself the instant the profile query reports onboarding_completed:
// true. (Issue #7.)
export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element | null {
  const { ready } = useRequireAuth();
  const { data } = useProfile();
  useOnboardingAbandonBeacon(data?.onboarding_completed ?? false);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <main className="flex min-h-screen items-start justify-center bg-background px-4 py-12">
      <div className="w-full max-w-2xl space-y-6">{children}</div>
    </main>
  );
}
