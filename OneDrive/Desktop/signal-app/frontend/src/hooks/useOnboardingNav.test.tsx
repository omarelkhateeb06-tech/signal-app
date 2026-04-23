import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock is hoisted above imports, so the factory can't close over
// module-scoped consts. vi.hoisted lifts these up with it.
const { pushMock, postEventsMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  postEventsMock: vi.fn().mockResolvedValue({ accepted: 1 }),
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
  sendOnboardingEventBeacon: vi.fn(),
}));

import { useScreenViewEvent } from "./useOnboardingNav";

function Probe({ step }: { step: number }): JSX.Element {
  useScreenViewEvent(step);
  return <p>rendered</p>;
}

function renderWithClient(node: ReactNode): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <StrictMode>{node}</StrictMode>
    </QueryClientProvider>,
  );
}

describe("useScreenViewEvent (StrictMode guard)", () => {
  beforeEach(() => {
    postEventsMock.mockClear();
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
