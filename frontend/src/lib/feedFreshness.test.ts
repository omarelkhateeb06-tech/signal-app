import { describe, expect, it } from "vitest";

import {
  FRESH_WINDOW_HOURS,
  freshBoundaryMs,
  freshnessTimestamp,
  isAfter,
  isRecent,
} from "./feedFreshness";

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

describe("isAfter", () => {
  const boundary = Date.parse("2026-06-06T08:00:00Z");
  it("is true for a timestamp after the boundary", () => {
    expect(isAfter("2026-06-06T09:00:00Z", boundary)).toBe(true);
  });
  it("is false at or before the boundary", () => {
    expect(isAfter("2026-06-06T08:00:00Z", boundary)).toBe(false);
    expect(isAfter("2026-06-06T07:00:00Z", boundary)).toBe(false);
  });
  it("is false for null / invalid", () => {
    expect(isAfter(null, boundary)).toBe(false);
    expect(isAfter("nope", boundary)).toBe(false);
  });
});

describe("freshBoundaryMs", () => {
  it("uses the previous visit when present (since you last looked)", () => {
    const prev = Date.parse("2026-06-05T12:00:00Z");
    expect(freshBoundaryMs(prev, NOW)).toBe(prev);
  });
  it("falls back to the rolling window on a first visit", () => {
    expect(freshBoundaryMs(null, NOW)).toBe(NOW - FRESH_WINDOW_HOURS * 3600 * 1000);
  });
  it("returns null before the client clock is known", () => {
    expect(freshBoundaryMs(null, null)).toBeNull();
    // a known previous visit still resolves even without nowMs
    expect(freshBoundaryMs(123, null)).toBe(123);
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
