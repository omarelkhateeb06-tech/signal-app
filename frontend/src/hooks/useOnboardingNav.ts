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

// Module-scoped visit accounting for useScreenViewEvent. `visitSeq`
// increments each time a Screen instance claims its visit id; the
// `emittedVisits` Set guards against re-emitting `screen_view` for
// the same logical visit. The useRef inside the hook preserves the
// id across React 18 StrictMode's effect double-invoke, so the
// second run sees the id already in the Set and returns. A genuine
// new mount (user navigated back, then forward; Suspense resolution;
// layout-level loading→ready flip) gets a new ref and therefore a
// new id — legitimate revisits emit again, which is the desired
// behavior. Observed pre-fix: `screen_view: 13` on a 7-screen flow
// with 2 Back presses (expected 9). The previous boolean-ref latch
// was correct under StrictMode's simulated cleanup-setup cycle but
// not against genuine remounts, where each rebirth created a fresh
// ref that re-emitted. (Second fix-it: Defect 2.)
let visitSeq = 0;
const emittedVisits = new Set<number>();

/** Exported solely for tests to start each case from a clean slate. */
export function __resetOnboardingTelemetryStateForTests(): void {
  visitSeq = 0;
  emittedVisits.clear();
}

// Session-storage latch flipped synchronously when the completion
// mutation resolves on Screen 7. The abandon beacon checks this flag
// and skips emission — without it, a `beforeunload` that fires during
// the Finish → /feed window (e.g. because the browser or an extension
// flushes listeners eagerly, or the user reloads on /feed before the
// profile refetch settles) would record the user as abandoning
// immediately after they completed. sessionStorage's native lifetime
// (same tab, clears on close) is the right scope: we want the guard
// to survive a reload of /feed but not leak into a future session.
// (Second fix-it: Defect 1.)
const COMPLETED_SESSION_KEY = "signal-onboarding-completed";

/**
 * Flip the session-scoped "onboarding completed" latch. Call this
 * synchronously from the success path of the completion mutation so
 * the abandon beacon — which may still be attached because the
 * profile query hasn't yet refetched the new `onboarding_completed:
 * true` — skips its emission on the subsequent navigation/unload.
 * (Second fix-it: Defect 1.)
 */
export function markOnboardingCompletedInSession(): void {
  if (typeof window !== "undefined") {
    window.sessionStorage.setItem(COMPLETED_SESSION_KEY, "1");
  }
}

function isOnboardingCompletedInSession(): boolean {
  return (
    typeof window !== "undefined" &&
    window.sessionStorage.getItem(COMPLETED_SESSION_KEY) === "1"
  );
}

/**
 * Fire exactly one `screen_view` event per logical screen visit.
 *
 * The previous implementation used a plain boolean useRef latch,
 * which is correct under React 18 StrictMode's *simulated* cleanup-
 * setup effect cycle (the ref survives the simulation). But in the
 * live app we observed `screen_view` counts running ~40% over the
 * expected total — the ref-per-instance guard doesn't survive any
 * code path that genuinely remounts a Screen component (a Suspense
 * resolution, a layout-level loading→ready flip, etc.), and each
 * rebirth creates a fresh ref that happily re-emits.
 *
 * The visit-id pattern tightens this without fighting the legitimate
 * revisit case: on first effect run the hook claims a monotonic id
 * from the module-scoped `visitSeq` and stores it in a ref. The ref
 * preserves the id across StrictMode's effect re-run, so the module-
 * scoped `emittedVisits` Set catches the duplicate and returns. A
 * real new mount (user pressed Back, then Continue, and a brand-new
 * Screen instance mounts) gets a new ref → new id → new Set entry →
 * emits again, which is what we want.
 *
 * On step 1 we also emit `onboarding_started` once per sessionStorage
 * key so a back-traversal doesn't re-fire it. (Issue #7; second
 * fix-it Defect 2.)
 *
 * Call at the top of each screen component — this is a normal hook,
 * the name just makes the intent unambiguous.
 */
export function useScreenViewEvent(step: number): void {
  const { mutate: emit } = useOnboardingEvents();
  const visitIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (visitIdRef.current === null) {
      visitIdRef.current = ++visitSeq;
    }
    const visitId = visitIdRef.current;
    if (emittedVisits.has(visitId)) return;
    emittedVisits.add(visitId);

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
 * - `emitCompleted()` — emits `screen_completed` for the current
 *   screen *without* navigating. Used by Screen 7 whose Finish path
 *   runs an async completion mutation and then `router.push("/feed")`
 *   rather than the usual `/onboarding/${next}` push, so goNext
 *   isn't the right fit. Without this, Screen 7 never emitted
 *   `screen_completed(7)` and the funnel counts came in one short
 *   (observed 8, expected 9 on a 7-screen flow with two re-Continues).
 *   (Second fix-it: Defect 2.)
 */
export function useOnboardingNav(step: number): {
  goNext: (nextStep: number) => void;
  goBack: () => void;
  skip: (nextStep: number) => void;
  emitCompleted: () => void;
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

  const emitCompleted = useCallback((): void => {
    emit([{ event_type: "screen_completed", screen_number: step }]);
  }, [emit, step]);

  return { goNext, goBack, skip, emitCompleted };
}

/**
 * `onboarding_abandoned` beacon. Attach in the onboarding layout so
 * it covers every screen — if the user closes the tab or reloads
 * before `onboarding_completed` flips to true on the server, we emit
 * one final event via fetch-with-keepalive (sendBeacon can't carry
 * the Bearer header the zod schema requires — see
 * `sendOnboardingEventBeacon`).
 *
 * `isCompleted` comes from the profile query. It's not sufficient on
 * its own: there's an async window between the user clicking Finish
 * (which calls `markOnboardingCompletedInSession` synchronously) and
 * the profile query refetching the new `onboarding_completed: true`.
 * If the user reloads /feed inside that window — or the browser
 * flushes beforeunload as part of the Next.js route transition —
 * we'd register the just-completed user as abandoning. The session-
 * scoped latch covers the gap: we check it at both effect-setup
 * time (to avoid attaching at all when already complete) and inside
 * the handler at fire time (in case completion happens after the
 * listener is already attached). (Issue #7; second fix-it Defect 1.)
 */
export function useOnboardingAbandonBeacon(isCompleted: boolean): void {
  useEffect(() => {
    if (isCompleted) return;
    if (isOnboardingCompletedInSession()) return;
    if (typeof window === "undefined") return;

    const handler = (): void => {
      // Re-check at fire time — completion may have happened since
      // the effect ran, and we'd rather lose an abandon event than
      // mis-attribute one on a successful finish.
      if (isOnboardingCompletedInSession()) return;
      sendOnboardingEventBeacon([{ event_type: "onboarding_abandoned" }]);
    };
    window.addEventListener("beforeunload", handler);
    return () => {
      window.removeEventListener("beforeunload", handler);
    };
  }, [isCompleted]);
}
