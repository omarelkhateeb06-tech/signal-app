/* eslint-disable @typescript-eslint/no-explicit-any */
import { checkAndSetReenrichRateLimit } from "../../src/lib/reenrichRateLimiter";

const EVENT_ID = "evt-rate-1";

describe("checkAndSetReenrichRateLimit", () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("returns allowed=true when SET NX succeeds", async () => {
    const set = jest.fn().mockResolvedValue("OK");
    const result = await checkAndSetReenrichRateLimit(EVENT_ID, {
      redis: { set } as any,
    });
    expect(result.allowed).toBe(true);
    expect(set).toHaveBeenCalledWith(
      `reenrich:rate:${EVENT_ID}`,
      "1",
      "EX",
      3600,
      "NX",
    );
  });

  it("returns allowed=false when SET NX returns null (key exists)", async () => {
    const set = jest.fn().mockResolvedValue(null);
    const result = await checkAndSetReenrichRateLimit(EVENT_ID, {
      redis: { set } as any,
    });
    expect(result.allowed).toBe(false);
  });

  it("returns allowed=false and warns on Redis error (no throw)", async () => {
    const set = jest.fn().mockRejectedValue(new Error("ECONNRESET"));
    const result = await checkAndSetReenrichRateLimit(EVENT_ID, {
      redis: { set } as any,
    });
    expect(result.allowed).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
    expect(warnSpy.mock.calls[0][0]).toContain("redis error");
  });

  it("returns allowed=false and warns when redis client is null", async () => {
    const result = await checkAndSetReenrichRateLimit(EVENT_ID, {
      redis: null,
    });
    expect(result.allowed).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
    expect(warnSpy.mock.calls[0][0]).toContain("redis unavailable");
  });
});
