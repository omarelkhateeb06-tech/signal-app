import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

function renderPage(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(<OnboardingStepPage />, { wrapper: Wrapper });
}

describe("Onboarding step dispatcher", () => {
  beforeEach(() => {
    pushMock.mockClear();
    useOnboardingStore.getState().reset();
    if (typeof window !== "undefined") window.sessionStorage.clear();
  });

  it("Screen 1: Continue is disabled until at least one sector is picked", async () => {
    paramsMock.current = { step: "1" };
    const user = userEvent.setup();
    renderPage();
    const cont = screen.getByRole("button", { name: /continue/i });
    expect(cont).toBeDisabled();
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
});
