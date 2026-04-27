import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateProfileInput } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  updateMyProfileRequest: vi.fn(),
}));

import * as api from "@/lib/api";
import { PROFILE_QUERY_KEY, useUpdateMyProfile } from "./useProfile";

const samplePayload: UpdateProfileInput = {
  sectors: ["ai"],
  role: "engineer",
  domain: "general_not_sure",
  seniority: "mid",
  topic_interests: [],
  goals: ["stay_informed"],
  depth_preference: "briefed",
  email_frequency: "weekly",
  email_unsubscribed: false,
};

function makeWrapper(): {
  client: QueryClient;
  Wrapper: (props: { children: ReactNode }) => JSX.Element;
} {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const Wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, Wrapper };
}

describe("useUpdateMyProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("invalidates profile, feed, and commentary caches on success", async () => {
    vi.mocked(api.updateMyProfileRequest).mockResolvedValue(
      // The hook only forwards the response; shape doesn't matter for
      // the cache-invalidation assertion this test cares about.
      {} as never,
    );
    const { client, Wrapper } = makeWrapper();

    // Seed every cache key the hook is supposed to invalidate so we can
    // assert isInvalidated flips per key. Multiple ["feed", …] and
    // ["commentary", …] entries verify the prefix-match behavior.
    client.setQueryData(PROFILE_QUERY_KEY, { user: {}, profile: null });
    client.setQueryData(["feed", []], { stories: [], total: 0 });
    client.setQueryData(["feed", ["ai"]], { stories: [], total: 0 });
    client.setQueryData(["commentary", "story-1", null], "x");
    client.setQueryData(["commentary", "story-2", "technical"], "y");

    const { result } = renderHook(() => useUpdateMyProfile(), {
      wrapper: Wrapper,
    });

    await result.current.mutateAsync(samplePayload);

    await waitFor(() => {
      expect(client.getQueryState(PROFILE_QUERY_KEY)?.isInvalidated).toBe(true);
      expect(client.getQueryState(["feed", []])?.isInvalidated).toBe(true);
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
});
