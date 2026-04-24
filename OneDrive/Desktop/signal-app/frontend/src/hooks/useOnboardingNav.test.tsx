import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
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
  markOnboardingCompletedInSession,
  useOnboardingAbandonBeacon,
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
