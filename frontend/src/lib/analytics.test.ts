import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { track } from "./analytics";

describe("track()", () => {
  const originalBeacon = navigator.sendBeacon;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:3001");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    // Restore in case a test replaced it.
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      writable: true,
      value: originalBeacon,
    });
  });

  it("sends a beacon with the event name when sendBeacon + base URL are available", () => {
    const beacon = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      writable: true,
      value: beacon,
    });

    track("checkout_started", { plan: "monthly" });

    expect(beacon).toHaveBeenCalledTimes(1);
    const [url, body] = beacon.mock.calls[0] as [string, Blob];
    expect(url).toContain("/api/v1/events");
    expect(body).toBeInstanceOf(Blob);
  });

  it("never throws even when the transport blows up", () => {
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      writable: true,
      value: () => {
        throw new Error("transport exploded");
      },
    });

    expect(() => track("upgrade_viewed")).not.toThrow();
  });

  it("does not throw when sendBeacon is unavailable", () => {
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      writable: true,
      value: undefined,
    });

    expect(() => track("theme_toggled", { theme: "dark" })).not.toThrow();
  });
});
