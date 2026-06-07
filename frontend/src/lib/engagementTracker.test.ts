import { beforeEach, describe, expect, it, vi } from "vitest";

const postMock = vi.fn().mockResolvedValue(undefined);
vi.mock("./api", () => ({
  postEngagementEventsRequest: (events: unknown) => postMock(events),
}));

import {
  trackEngagement,
  flushEngagement,
  pendingEngagementCount,
  __resetEngagementForTests,
} from "./engagementTracker";

beforeEach(() => {
  postMock.mockClear();
  __resetEngagementForTests();
});

describe("engagementTracker", () => {
  it("queues events and flushes them as a single batch", () => {
    trackEngagement({ event_type: "click_through", event_id: "a" });
    trackEngagement({ event_type: "story_view", event_id: "a", dwell_ms: 1000 });
    expect(pendingEngagementCount()).toBe(2);

    flushEngagement();

    expect(postMock).toHaveBeenCalledTimes(1);
    expect(postMock.mock.calls[0][0]).toHaveLength(2);
    expect(pendingEngagementCount()).toBe(0);
  });

  it("stamps occurred_at when the caller omits it", () => {
    trackEngagement({ event_type: "share", event_id: "x" });
    flushEngagement();
    const batch = postMock.mock.calls[0][0] as Array<{ occurred_at?: string }>;
    expect(typeof batch[0]?.occurred_at).toBe("string");
  });

  it("auto-flushes when the queue hits the size threshold", () => {
    for (let i = 0; i < 12; i++) {
      trackEngagement({ event_type: "click_through", event_id: String(i) });
    }
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(postMock.mock.calls[0][0]).toHaveLength(12);
    expect(pendingEngagementCount()).toBe(0);
  });

  it("flush is a no-op on an empty queue", () => {
    flushEngagement();
    expect(postMock).not.toHaveBeenCalled();
  });
});
