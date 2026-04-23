import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PROFILE_QUERY_KEY } from "@/hooks/useProfile";

const pushMock = vi.fn();
const paramsMock = { current: { step: "1" } };

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  useParams: () => paramsMock.current,
  usePathname: () => `/onboarding/${paramsMock.current.step}`,
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

vi.mock("@/lib/api", () => ({
  postOnboardingEventsRequest: vi.fn().mockResolvedValue({ accepted: 1 }),
  postOnboardingCompleteRequest: vi.fn().mockResolvedValue({
    profile: { completedAt: "2026-04-23T00:00:00Z" },
    completed_at: "2026-04-23T00:00:00Z",
  }),
  extractApiError: (_e: unknown, fallback: string) => fallback,
}));

import OnboardingStepPage from "./page";
import { useOnboardingStore } from "@/store/onboardingStore";

function renderPage(): { client: QueryClient } {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(<OnboardingStepPage />, { wrapper: Wrapper });
  return { client };
}

describe("Onboarding step dispatcher", () => {
  beforeEach(() => {
    pushMock.mockClear();
    useOnboardingStore.getState().reset();
    if (typeof window !== "undefined") window.sessionStorage.clear();
  });

  it("Screen 1: all sectors start pre-selected (Issue #10); unchecking the last disables Continue", async () => {
    paramsMock.current = { step: "1" };
    const user = userEvent.setup();
    renderPage();
    const cont = screen.getByRole("button", { name: /continue/i });
    // Seeded with all three sectors → Continue enabled from first paint.
    expect(cont).not.toBeDisabled();
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(3);
    // Uncheck every one and confirm Continue goes disabled — the
    // canContinue={sectors.length >= 1} invariant still holds.
    for (const cb of checkboxes) await user.click(cb);
    expect(cont).toBeDisabled();
    // Re-check one and proceed — push target is still /onboarding/2.
    await user.click(screen.getByRole("checkbox", { name: /^AI\b/ }));
    expect(cont).not.toBeDisabled();
    await user.click(cont);
    expect(pushMock).toHaveBeenCalledWith("/onboarding/2");
  });

  it("Screen 5: skip fills the store with all topics for selected sectors", async () => {
    paramsMock.current = { step: "5" };
    useOnboardingStore.getState().setSectors(["ai"]);
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: /skip/i }));
    const topics = useOnboardingStore.getState().topics;
    expect(topics.length).toBeGreaterThan(0);
    expect(topics.every((t) => t.sector === "ai")).toBe(true);
    expect(pushMock).toHaveBeenCalledWith("/onboarding/6");
  });

  it("Screen 6: skip submits ['stay_current'] as the default goal", async () => {
    paramsMock.current = { step: "6" };
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: /skip/i }));
    expect(useOnboardingStore.getState().goals).toEqual(["stay_current"]);
    expect(pushMock).toHaveBeenCalledWith("/onboarding/7");
  });

  // Regression for Issue #5 — on Finish, the mutation must invalidate
  // PROFILE_QUERY_KEY *before* the router.push("/feed") fires, or the
  // (app) layout reads stale onboarding_completed: false and bounces
  // back to /onboarding/1.
  it("Screen 7: Finish invalidates the profile cache before pushing to /feed", async () => {
    paramsMock.current = { step: "7" };
    const store = useOnboardingStore.getState();
    store.setSectors(["ai"]);
    store.setRole("engineer");
    store.setSeniority("mid");
    store.setDepthPreference("standard");
    store.setGoals(["stay_current"]);
    store.setTopics([{ sector: "ai", topic: "foundation_models" }]);
    store.setDigestPreference("morning");
    store.setTimezone("UTC");

    const user = userEvent.setup();
    const { client } = renderPage();
    // Seed a known-stale cache entry so invalidateQueries has something
    // observable to mark as stale.
    client.setQueryData(PROFILE_QUERY_KEY, { onboarding_completed: false });
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");

    await user.click(screen.getByRole("button", { name: /finish/i }));

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: PROFILE_QUERY_KEY });
    });
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/feed");
    });
  });
});
