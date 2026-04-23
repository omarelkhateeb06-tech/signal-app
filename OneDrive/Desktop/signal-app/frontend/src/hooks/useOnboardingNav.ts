"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useOnboardingEvents } from "./useProfile";
import { sendOnboardingEventBeacon } from "@/lib/api";

// Session-storage key set once per onboarding session after we emit
// the very first `onboarding_started`. Prevents a back-traversal to
// Screen 1 (which remounts the hook) from firing a second started
// event.
const STARTED_SESSION_KEY = "signal-onboarding-started-sent";

/**
 * Fire exactly one `screen_view` event per mount cycle. React
 * StrictMode double-invokes effects in dev, which previously caused
 * every screen to record two impressions. A useRef latch makes the
 * effect idempotent without fighting the dependency array. On step 1
 * we also emit `onboarding_started` once per session (keyed by
 * sessionStorage so a back-traversal doesn't re-fire it). (Issue #7.)
 *
 * Call at the top of each screen component — this is a normal hook,
 * the name just makes the intent unambiguous.
 */
export function useScreenViewEvent(step: number): void {
  const { mutate: emit } = useOnboardingEvents();
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    const events: { event_type: string; screen_number?: number | null }[] = [];
    if (step === 1 && typeof window !== "undefined") {
      const alreadyStarted =
        window.sessionStorage.getItem(STARTED_SESSION_KEY) === "1";
      if (!alreadyStarted) {
        window.sessionStorage.setItem(STARTED_SESSION_KEY, "1");
        events.push({ event_type: "onboarding_started", screen_number: 1 });
      }
    }
    events.push({ event_type: "screen_view", screen_number: step });
    emit(events);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/**
 * Navigation helpers that emit the matching funnel event before
 * pushing the next route.
 *
 * - `goNext(nextStep)` — emits `screen_completed` for the current
 *   screen, then pushes.
 * - `goBack()` — emits `screen_back` with the destination screen
 *   number (the screen we're returning to), then pushes. No-ops on
 *   step 1.
 * - `skip(nextStep)` — emits `screen_skipped` for the current screen,
 *   then pushes.
 */
export function useOnboardingNav(step: number): {
  goNext: (nextStep: number) => void;
  goBack: () => void;
  skip: (nextStep: number) => void;
} {
  const router = useRouter();
  const { mutate: emit } = useOnboardingEvents();

  const goNext = useCallback(
    (nextStep: number): void => {
      emit([{ event_type: "screen_completed", screen_number: step }]);
      router.push(`/onboarding/${nextStep}`);
    },
    [emit, router, step],
  );

  const goBack = useCallback((): void => {
    if (step <= 1) return;
    const prev = step - 1;
    emit([{ event_type: "screen_back", screen_number: prev }]);
    router.push(`/onboarding/${prev}`);
  }, [emit, router, step]);

  const skip = useCallback(
    (nextStep: number): void => {
      emit([{ event_type: "screen_skipped", screen_number: step }]);
      router.push(`/onboarding/${nextStep}`);
    },
    [emit, router, step],
  );

  return { goNext, goBack, skip };
}

/**
 * `onboarding_abandoned` beacon. Attach in the onboarding layout so
 * it covers every screen — if the user closes the tab or reloads
 * before `onboarding_completed` flips to true on the server, we emit
 * one final event via fetch-with-keepalive (sendBeacon can't carry
 * the Bearer header the zod schema requires — see
 * `sendOnboardingEventBeacon`).
 *
 * `isCompleted` should come from the profile query; when it flips
 * true we detach so the event never fires on the normal router.push
 * away from /onboarding after Finish. (Issue #7.)
 */
export function useOnboardingAbandonBeacon(isCompleted: boolean): void {
  useEffect(() => {
    if (isCompleted) return;
    if (typeof window === "undefined") return;

    const handler = (): void => {
      sendOnboardingEventBeacon([{ event_type: "onboarding_abandoned" }]);
    };
    window.addEventListener("beforeunload", handler);
    return () => {
      window.removeEventListener("beforeunload", handler);
    };
  }, [isCompleted]);
}
