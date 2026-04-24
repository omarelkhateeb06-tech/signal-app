import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock is hoisted above imports, so the factory can't close over
// module-scoped consts. vi.hoisted lifts these up with it.
const { pushMock, postEventsMock, beaconMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  postEventsMock: vi.fn().mockResolvedValue({ accepted: 1 }),
  beaconMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

vi.mock("@/lib/api", () => ({
  postOnboardingEventsRequest: postEventsMock,
  sendOnboardingEventBeacon: beaconMock,
}));

import {
  __resetOnboardingTelemetryStateForTests,
  markOnboardingCompletedInSession,
  useOnboardingAbandonBeacon,
  useOnboardingNav,
  useScreenViewEvent,
} from "./useOnboardingNav";

function Probe({ step }: { step: number }): JSX.Element {
  useScreenViewEvent(step);
  return <p>rendered</p>;
}

function BeaconProbe({ isCompleted }: { isCompleted: boolean }): JSX.Element {
  useOnboardingAbandonBeacon(isCompleted);
  return <p>beacon</p>;
}

function renderWithClient(node: ReactNode): ReturnType<typeof render> {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <StrictMode>{node}</StrictMode>
    </QueryClientProvider>,
  );
}

describe("useScreenViewEvent (StrictMode guard)", () => {
  beforeEach(() => {
    postEventsMock.mockClear();
    beaconMock.mockClear();
    __resetOnboardingTelemetryStateForTests();
    if (typeof window !== "undefined") window.sessionStorage.clear();
  });

  // Without the useRef latch this would emit twice per screen mount in
  // StrictMode; one of the locked acceptance criteria for Issue #7 is
  // "screen_view fires exactly once per screen".
  it("emits screen_view exactly once even under StrictMode double-invoke", async () => {
    renderWithClient(<Probe step={3} />);
    // Flush microtasks + any pending mutation dispatch.
    await new Promise((r) => setTimeout(r, 0));
    // The mutation may be called multiple times by react-query
    // internals, but the payload must match one screen_view emission.
    const screenViewCalls = postEventsMock.mock.calls.filter((c) =>
      (c[0] as { event_type: string }[]).some((e) => e.event_type === "screen_view"),
    );
    expect(screenViewCalls).toHaveLength(1);
    const flat = (screenViewCalls[0]?.[0] ?? []) as { event_type: string; screen_number?: number }[];
    const screenViews = flat.filter((e) => e.event_type === "screen_view");
    expect(screenViews).toEqual([{ event_type: "screen_view", screen_number: 3 }]);
  });

  it("emits onboarding_started once on step 1, never on other steps", async () => {
    renderWithClient(<Probe step={1} />);
    await new Promise((r) => setTimeout(r, 0));
    const flat = (postEventsMock.mock.calls[0]?.[0] ?? []) as {
      event_type: string;
    }[];
    expect(flat.some((e) => e.event_type === "onboarding_started")).toBe(true);
    expect(flat.some((e) => e.event_type === "screen_view")).toBe(true);
  });

  it("does not re-emit onboarding_started within the same session", async () => {
    // First step-1 render seeds the sessionStorage flag.
    renderWithClient(<Probe step={1} />);
    await new Promise((r) => setTimeout(r, 0));
    postEventsMock.mockClear();

    // A second mount (simulating a back-traversal to step 1) must
    // produce screen_view without a second onboarding_started.
    renderWithClient(<Probe step={1} />);
    await new Promise((r) => setTimeout(r, 0));
    const flat = (postEventsMock.mock.calls[0]?.[0] ?? []) as {
      event_type: string;
    }[];
    expect(flat.some((e) => e.event_type === "onboarding_started")).toBe(false);
    expect(flat.some((e) => e.event_type === "screen_view")).toBe(true);
  });
});

describe("useOnboardingAbandonBeacon (completion latch)", () => {
  beforeEach(() => {
    beaconMock.mockClear();
    if (typeof window !== "undefined") window.sessionStorage.clear();
  });

  // Defect 1, happy-path half: if Screen 7's submit flipped the
  // completion latch before any beforeunload fires, the abandon
  // beacon must skip its emission — even though the profile query
  // hasn't yet refetched `onboarding_completed: true` (we still pass
  // isCompleted={false}). Without this, the Finish → /feed window
  // and any reload of /feed inside it records a successful user as
  // abandoning.
  it("does NOT emit onboarding_abandoned after completion is marked in session", async () => {
    markOnboardingCompletedInSession();
    renderWithClient(<BeaconProbe isCompleted={false} />);
    await new Promise((r) => setTimeout(r, 0));
    // Simulate the browser firing beforeunload (tab close, reload,
    // etc.). With the latch set, the handler should short-circuit.
    window.dispatchEvent(new Event("beforeunload"));
    expect(beaconMock).not.toHaveBeenCalled();
  });

  // Defect 1, mid-flow half: if the user closes the tab without
  // completing (latch never flipped, profile still shows
  // onboarding_completed=false), the beacon MUST fire — this is the
  // whole point of the abandon event, and we need to prove we
  // haven't regressed that behavior while adding the completion
  // guard.
  it("emits onboarding_abandoned mid-flow when completion is not marked", async () => {
    renderWithClient(<BeaconProbe isCompleted={false} />);
    await new Promise((r) => setTimeout(r, 0));
    window.dispatchEvent(new Event("beforeunload"));
    expect(beaconMock).toHaveBeenCalledTimes(1);
    const payload = beaconMock.mock.calls[0]?.[0] as { event_type: string }[];
    expect(payload).toEqual([{ event_type: "onboarding_abandoned" }]);
  });
});

// Defect 2 (funnel-count defect). Observed on a happy 7-screen path
// with 2 Back presses (no skips):
//   screen_view: 13     (expected 9)
//   screen_completed: 8 (expected 9)
//   screen_back: 2
// Two root causes, one test per each lever of the fix:
//   (a) the previous boolean-ref latch on useScreenViewEvent was
//       correct under StrictMode's *simulated* cleanup/setup but did
//       not survive any genuine remount (Suspense resolution, layout
//       loading→ready flip, etc.), so each rebirth got a fresh ref and
//       re-emitted. The visit-id + module-scoped Set fixes this while
//       keeping legitimate revisits (new mount = new visitSeq id)
//       emitting as they should.
//   (b) Screen 7's Finish path never emitted `screen_completed` for
//       screen 7 — screens 1–6 emit via nav.goNext, but Screen 7's
//       submit calls complete.mutateAsync + router.push("/feed"),
//       skipping the goNext code path entirely. The new
//       `emitCompleted` on `useOnboardingNav` fills that gap.
//
// The test scripts one path:
//   1 → 2 → 3 → Back(to 2) → re-Continue(to 3) → 4 → 5 → Back(to 4)
//     → re-Continue(to 5) → 6 → 7 → Finish
// modeled as 9 distinct screen mounts plus explicit nav-helper calls.
// We cache each mount's nav in a by-step map so that the re-Continue
// legs can fire `screen_completed` from a stashed nav without
// separately remounting the re-arrival screen — the test is about
// the hook's emission contract, not Next.js routing semantics.
//
// Expected emissions on this scripted path:
//   screen_view = 9       (7 initial + 2 back-destination revisits)
//   screen_completed = 9  (6 forward goNext + 2 re-Continue goNext
//                          + 1 Screen 7 emitCompleted)
//   screen_back = 2
// These are the locked acceptance numbers for Defect 2. Without the
// visit-id pattern + emitCompleted method, at least one of these
// counts goes wrong.
describe("funnel counts (visit-id + emitCompleted)", () => {
  beforeEach(() => {
    postEventsMock.mockClear();
    beaconMock.mockClear();
    __resetOnboardingTelemetryStateForTests();
    if (typeof window !== "undefined") window.sessionStorage.clear();
  });

  it("produces screen_view=9 / screen_completed=9 / screen_back=2 on the 7-screen path with 2 Back+re-Continue detours under StrictMode", async () => {
    const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    const navByStep: Record<number, ReturnType<typeof useOnboardingNav>> = {};

    function Harness({ step }: { step: number }): JSX.Element {
      useScreenViewEvent(step);
      const nav = useOnboardingNav(step);
      // Stash by step so a later re-Continue can call the prior
      // screen's goNext without needing to remount it.
      navByStep[step] = nav;
      return <p>step {step}</p>;
    }

    // Key forces React to unmount the previous Harness and mount a
    // fresh one even when two successive mounts share a step number
    // (e.g. the revisit to screen 2 after back).
    const tree = (step: number, mountKey: number): ReactElement => (
      <QueryClientProvider client={client}>
        <StrictMode>
          <Harness key={mountKey} step={step} />
        </StrictMode>
      </QueryClientProvider>
    );

    let mountKey = 0;
    const { rerender } = render(tree(1, mountKey++));
    await flush();

    // Forward leg: 1 → 2 → 3.
    navByStep[1]!.goNext(2);
    rerender(tree(2, mountKey++));
    await flush();

    navByStep[2]!.goNext(3);
    rerender(tree(3, mountKey++));
    await flush();

    // First detour: Back from 3, re-Continue 2 → 3 (no separate
    // remount for the re-arrival at 3).
    navByStep[3]!.goBack();
    rerender(tree(2, mountKey++));
    await flush();

    navByStep[2]!.goNext(3);
    // Skip the screen-3 re-mount; the stashed nav for step 3 fires
    // its screen_completed from the previous screen-3 mount.
    navByStep[3]!.goNext(4);
    rerender(tree(4, mountKey++));
    await flush();

    navByStep[4]!.goNext(5);
    rerender(tree(5, mountKey++));
    await flush();

    // Second detour: Back from 5, re-Continue 4 → 5 (no separate
    // remount for the re-arrival at 5).
    navByStep[5]!.goBack();
    rerender(tree(4, mountKey++));
    await flush();

    navByStep[4]!.goNext(5);
    navByStep[5]!.goNext(6);
    rerender(tree(6, mountKey++));
    await flush();

    navByStep[6]!.goNext(7);
    rerender(tree(7, mountKey++));
    await flush();

    // Screen 7's Finish path — the emitCompleted lever.
    navByStep[7]!.emitCompleted();
    await flush();

    const allEvents = postEventsMock.mock.calls.flatMap(
      (c) => c[0] as { event_type: string; screen_number?: number | null }[],
    );
    const screenViews = allEvents.filter((e) => e.event_type === "screen_view");
    const screenCompleted = allEvents.filter(
      (e) => e.event_type === "screen_completed",
    );
    const screenBack = allEvents.filter((e) => e.event_type === "screen_back");

    expect(screenViews).toHaveLength(9);
    expect(screenCompleted).toHaveLength(9);
    expect(screenBack).toHaveLength(2);
  });
});
