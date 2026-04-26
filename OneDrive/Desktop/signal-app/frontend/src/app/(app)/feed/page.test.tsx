import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedResponse } from "@/types/story";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/feed",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

vi.mock("@/lib/api", () => ({
  getFeedRequest: vi.fn(),
  listTeamsRequest: vi.fn(),
  extractApiError: (_err: unknown, fallback: string) => fallback,
}));

import * as api from "@/lib/api";
import FeedPage from "./page";

const emptyFeed: FeedResponse = {
  stories: [],
  total: 0,
  limit: 10,
  offset: 0,
  has_more: false,
};

function renderPage(): { client: QueryClient } {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const Wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(<FeedPage />, { wrapper: Wrapper });
  return { client };
}

describe("FeedPage refresh button", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getFeedRequest).mockResolvedValue(emptyFeed);
    vi.mocked(api.listTeamsRequest).mockResolvedValue([]);
  });

  it("renders an accessible refresh affordance", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /refresh feed/i })).toBeInTheDocument(),
    );
  });

  it("invalidates feed and commentary caches on click", async () => {
    const { client } = renderPage();
    // Wait for the initial feed fetch to settle so the refetch we
    // trigger below is the one being asserted on.
    await waitFor(() => expect(api.getFeedRequest).toHaveBeenCalledTimes(1));

    // Seed inactive cache entries the click should invalidate via the
    // prefix match. We assert isInvalidated on these because they have
    // no observers — invalidate marks them stale but doesn't refetch,
    // so the flag stays true. The active ["feed", []] query is covered
    // by the getFeedRequest refetch assertion below: invalidate+refetch
    // would un-flip isInvalidated on settle, so observing the network
    // call is the cleaner signal.
    client.setQueryData(["feed", ["ai"]], emptyFeed);
    client.setQueryData(["commentary", "story-1", null], "x");
    client.setQueryData(["commentary", "story-2", "technical"], "y");

    const button = screen.getByRole("button", { name: /refresh feed/i });
    await userEvent.click(button);

    // The active feed query refetches.
    await waitFor(() =>
      expect(api.getFeedRequest).toHaveBeenCalledTimes(2),
    );

    // Inactive prefix-matched entries are marked stale.
    expect(client.getQueryState(["feed", ["ai"]])?.isInvalidated).toBe(true);
    expect(
      client.getQueryState(["commentary", "story-1", null])?.isInvalidated,
    ).toBe(true);
    expect(
      client.getQueryState(["commentary", "story-2", "technical"])
        ?.isInvalidated,
    ).toBe(true);
  });
});
