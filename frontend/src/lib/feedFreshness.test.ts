import { describe, expect, it } from "vitest";

import { FRESH_WINDOW_HOURS, freshnessTimestamp, isRecent } from "./feedFreshness";

const NOW = Date.parse("2026-06-06T12:00:00Z");
const hoursAgo = (h: number): string =>
  new Date(NOW - h * 60 * 60 * 1000).toISOString();

describe("isRecent", () => {
  it("is true within the default freshness window", () => {
    expect(isRecent(hoursAgo(2), NOW)).toBe(true);
    expect(isRecent(hoursAgo(FRESH_WINDOW_HOURS - 1), NOW)).toBe(true);
  });

  it("is false once older than the window", () => {
    expect(isRecent(hoursAgo(FRESH_WINDOW_HOURS + 2), NOW)).toBe(false);
    expect(isRecent(hoursAgo(72), NOW)).toBe(false);
  });

  it("respects a custom window", () => {
    expect(isRecent(hoursAgo(5), NOW, 6)).toBe(true);
    expect(isRecent(hoursAgo(7), NOW, 6)).toBe(false);
  });

  it("returns false for null / invalid timestamps", () => {
    expect(isRecent(null, NOW)).toBe(false);
    expect(isRecent(undefined, NOW)).toBe(false);
    expect(isRecent("not-a-date", NOW)).toBe(false);
  });

  it("tolerates small clock skew but rejects far-future stamps", () => {
    expect(isRecent(new Date(NOW + 2 * 60 * 1000).toISOString(), NOW)).toBe(true);
    expect(isRecent(new Date(NOW + 60 * 60 * 1000).toISOString(), NOW)).toBe(
      false,
    );
  });
});

describe("freshnessTimestamp", () => {
  it("prefers published_at when present", () => {
    expect(
      freshnessTimestamp({ published_at: "2026-06-06T09:00:00Z", created_at: "x" }),
    ).toBe("2026-06-06T09:00:00Z");
  });

  it("falls back to created_at when published_at is null", () => {
    expect(
      freshnessTimestamp({ published_at: null, created_at: "2026-06-05T00:00:00Z" }),
    ).toBe("2026-06-05T00:00:00Z");
  });
});
