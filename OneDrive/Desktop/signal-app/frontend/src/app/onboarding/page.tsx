import { redirect } from "next/navigation";

// Phase 12b replaced the old single-page onboarding with a 7-screen
// flow routed under /onboarding/[step]. The bare /onboarding URL is
// kept as a permanent redirect so any existing bookmarks, emails, or
// post-signup handlers that still point at it land on step 1.
export default function OnboardingIndex(): never {
  redirect("/onboarding/1");
}
