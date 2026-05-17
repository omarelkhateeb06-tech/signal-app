/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Redis } from "ioredis";

// Redis mock at the lib boundary — getRedis() returns either our jest
// mock or null. Matches the apiKeyRateLimit test pattern.
const sismemberMock = jest.fn();
const scardMock = jest.fn();
const saddMock = jest.fn();
const smembersMock = jest.fn();
const expireMock = jest.fn();
const ttlMock = jest.fn();
const incrMock = jest.fn();

let redisInstance: Pick<
  Redis,
  "sismember" | "scard" | "sadd" | "smembers" | "expire" | "ttl" | "incr"
> | null = {
  sismember: sismemberMock as unknown as Redis["sismember"],
  scard: scardMock as unknown as Redis["scard"],
  sadd: saddMock as unknown as Redis["sadd"],
  smembers: smembersMock as unknown as Redis["smembers"],
  expire: expireMock as unknown as Redis["expire"],
  ttl: ttlMock as unknown as Redis["ttl"],
  incr: incrMock as unknown as Redis["incr"],
};

jest.mock("../../src/lib/redis", () => ({
  __esModule: true,
  getRedis: () => redisInstance,
  isRedisConfigured: () => redisInstance !== null,
}));

const captureMessageMock = jest.fn();
jest.mock("@sentry/node", () => ({
  __esModule: true,
  captureMessage: (...args: unknown[]) => captureMessageMock(...args),
}));

import {
  buildGatePayload,
  buildSearchLimitGate,
  buildUpgradeCta,
  FREE_TIER_SEARCH_CAP,
  FREE_TIER_STORY_CAP,
  getViewedStoryIds,
  recordOrCheckSearch,
  recordOrCheckStoryView,
  teaserFirstLine,
} from "../../src/services/paywallService";

const NOW = new Date("2026-05-17T12:00:00Z");
const USER = "user-1";
const STORY = "11111111-1111-1111-1111-111111111111";

function resetRedis(): void {
  sismemberMock.mockReset();
  scardMock.mockReset();
  saddMock.mockReset();
  smembersMock.mockReset();
  expireMock.mockReset();
  ttlMock.mockReset();
  incrMock.mockReset();
  captureMessageMock.mockReset();
  redisInstance = {
    sismember: sismemberMock as unknown as Redis["sismember"],
    scard: scardMock as unknown as Redis["scard"],
    sadd: saddMock as unknown as Redis["sadd"],
    smembers: smembersMock as unknown as Redis["smembers"],
    expire: expireMock as unknown as Redis["expire"],
    ttl: ttlMock as unknown as Redis["ttl"],
    incr: incrMock as unknown as Redis["incr"],
  };
}

describe("paywallService", () => {
  beforeEach(() => {
    resetRedis();
  });

  describe("getViewedStoryIds", () => {
    it("returns available=false snapshot when Redis is not configured", async () => {
      redisInstance = null;
      const snap = await getViewedStoryIds(USER, NOW);
      expect(snap.available).toBe(false);
      expect(snap.count).toBe(0);
      expect(snap.ids.size).toBe(0);
    });

    it("returns the set members and count on success", async () => {
      smembersMock.mockResolvedValueOnce(["a", "b", "c"]);
      const snap = await getViewedStoryIds(USER, NOW);
      expect(snap.available).toBe(true);
      expect(snap.count).toBe(3);
      expect(snap.ids).toEqual(new Set(["a", "b", "c"]));
      expect(smembersMock).toHaveBeenCalledWith(
        `paywall:stories:viewed:${USER}:2026-05-17`,
      );
    });

    it("fail-opens on Redis error and logs a Sentry warning", async () => {
      smembersMock.mockRejectedValueOnce(new Error("boom"));
      const snap = await getViewedStoryIds(USER, NOW);
      expect(snap.available).toBe(false);
      expect(snap.count).toBe(0);
      expect(captureMessageMock).toHaveBeenCalledWith(
        expect.stringContaining("SMEMBERS failed"),
        expect.objectContaining({ level: "warning" }),
      );
    });
  });

  describe("recordOrCheckStoryView", () => {
    it("fail-opens (gated=false) when Redis is not configured", async () => {
      redisInstance = null;
      const decision = await recordOrCheckStoryView(USER, STORY, NOW);
      expect(decision).toEqual({
        gated: false,
        alreadyViewed: false,
        newCount: 0,
      });
    });

    it("returns alreadyViewed for a re-read without incrementing", async () => {
      sismemberMock.mockResolvedValueOnce(1);
      scardMock.mockResolvedValueOnce(7);
      const decision = await recordOrCheckStoryView(USER, STORY, NOW);
      expect(decision).toEqual({
        gated: false,
        alreadyViewed: true,
        newCount: 7,
      });
      expect(saddMock).not.toHaveBeenCalled();
      expect(expireMock).not.toHaveBeenCalled();
    });

    it("admits the first view of the day and anchors TTL to UTC midnight", async () => {
      sismemberMock.mockResolvedValueOnce(0);
      scardMock.mockResolvedValueOnce(0);
      saddMock.mockResolvedValueOnce(1);
      const decision = await recordOrCheckStoryView(USER, STORY, NOW);
      expect(decision).toEqual({
        gated: false,
        alreadyViewed: false,
        newCount: 1,
      });
      expect(saddMock).toHaveBeenCalledWith(
        `paywall:stories:viewed:${USER}:2026-05-17`,
        STORY,
      );
      // 2026-05-17T12:00:00Z → 12 hours to next UTC midnight = 43200s.
      expect(expireMock).toHaveBeenCalledWith(expect.any(String), 43200);
    });

    it("admits a subsequent view without re-setting TTL when TTL is healthy", async () => {
      sismemberMock.mockResolvedValueOnce(0);
      scardMock.mockResolvedValueOnce(4);
      saddMock.mockResolvedValueOnce(1);
      ttlMock.mockResolvedValueOnce(38000); // positive TTL — no re-anchor
      const decision = await recordOrCheckStoryView(USER, STORY, NOW);
      expect(decision.gated).toBe(false);
      expect(decision.newCount).toBe(5);
      expect(expireMock).not.toHaveBeenCalled();
    });

    it("re-anchors TTL when the key has no expiry (TTL = -1)", async () => {
      sismemberMock.mockResolvedValueOnce(0);
      scardMock.mockResolvedValueOnce(2);
      saddMock.mockResolvedValueOnce(1);
      ttlMock.mockResolvedValueOnce(-1);
      await recordOrCheckStoryView(USER, STORY, NOW);
      expect(expireMock).toHaveBeenCalled();
    });

    it("returns gated when the user is exactly at the cap and the story is new", async () => {
      sismemberMock.mockResolvedValueOnce(0);
      scardMock.mockResolvedValueOnce(FREE_TIER_STORY_CAP);
      const decision = await recordOrCheckStoryView(USER, STORY, NOW);
      expect(decision).toEqual({
        gated: true,
        alreadyViewed: false,
        newCount: FREE_TIER_STORY_CAP,
      });
      expect(saddMock).not.toHaveBeenCalled();
    });

    it("fail-opens on Redis error and logs a Sentry warning", async () => {
      sismemberMock.mockRejectedValueOnce(new Error("redis down"));
      const decision = await recordOrCheckStoryView(USER, STORY, NOW);
      expect(decision).toEqual({
        gated: false,
        alreadyViewed: false,
        newCount: 0,
      });
      expect(captureMessageMock).toHaveBeenCalledWith(
        expect.stringContaining("Redis op failed"),
        expect.objectContaining({ level: "warning" }),
      );
    });
  });

  describe("recordOrCheckSearch", () => {
    it("fail-opens (gated=false) when Redis is not configured", async () => {
      redisInstance = null;
      const decision = await recordOrCheckSearch(USER, NOW);
      expect(decision).toEqual({ gated: false, newCount: 0 });
    });

    it("admits the first search of the day and anchors TTL", async () => {
      incrMock.mockResolvedValueOnce(1);
      const decision = await recordOrCheckSearch(USER, NOW);
      expect(decision).toEqual({ gated: false, newCount: 1 });
      expect(incrMock).toHaveBeenCalledWith(
        `paywall:searches:${USER}:2026-05-17`,
      );
      expect(expireMock).toHaveBeenCalledWith(expect.any(String), 43200);
    });

    it("admits searches up to and including the cap", async () => {
      incrMock.mockResolvedValueOnce(FREE_TIER_SEARCH_CAP);
      const decision = await recordOrCheckSearch(USER, NOW);
      expect(decision.gated).toBe(false);
      expect(decision.newCount).toBe(FREE_TIER_SEARCH_CAP);
      expect(expireMock).not.toHaveBeenCalled(); // not the first INCR
    });

    it("gates the first request that pushes the counter past the cap", async () => {
      incrMock.mockResolvedValueOnce(FREE_TIER_SEARCH_CAP + 1);
      const decision = await recordOrCheckSearch(USER, NOW);
      expect(decision.gated).toBe(true);
      expect(decision.newCount).toBe(FREE_TIER_SEARCH_CAP + 1);
    });

    it("fail-opens on Redis error and logs a Sentry warning", async () => {
      incrMock.mockRejectedValueOnce(new Error("redis boom"));
      const decision = await recordOrCheckSearch(USER, NOW);
      expect(decision).toEqual({ gated: false, newCount: 0 });
      expect(captureMessageMock).toHaveBeenCalledWith(
        expect.stringContaining("INCR (search) failed"),
        expect.objectContaining({ level: "warning" }),
      );
    });
  });

  describe("buildSearchLimitGate", () => {
    it("returns a search_limit gate with a static teaser and matching CTA", () => {
      const payload = buildSearchLimitGate(true);
      expect(payload.gated).toBe(true);
      expect(payload.gate_reason).toBe("search_limit");
      expect(payload.teaser.headline).toBe("Search limit reached");
      expect(payload.teaser.first_line).toContain(
        `${FREE_TIER_SEARCH_CAP} of ${FREE_TIER_SEARCH_CAP}`,
      );
      expect(payload.upgrade_cta.trial_available).toBe(true);
    });
  });

  describe("buildUpgradeCta", () => {
    it("offers the trial when trial_available is true", () => {
      const cta = buildUpgradeCta(true);
      expect(cta.trial_available).toBe(true);
      expect(cta.message).toContain("Pro free for 7 days");
    });

    it("offers the price when trial_available is false", () => {
      const cta = buildUpgradeCta(false);
      expect(cta.trial_available).toBe(false);
      expect(cta.message).toContain("$10/month");
    });
  });

  describe("buildGatePayload", () => {
    it("includes the gate_reason, teaser, and CTA from the inputs", () => {
      const payload = buildGatePayload(
        "story_limit",
        "Big headline",
        "First line.",
        false,
      );
      expect(payload.gated).toBe(true);
      expect(payload.gate_reason).toBe("story_limit");
      expect(payload.teaser).toEqual({
        headline: "Big headline",
        first_line: "First line.",
      });
      expect(payload.upgrade_cta.message).toContain("$10/month");
    });
  });

  describe("teaserFirstLine", () => {
    it("returns the text up to the first sentence terminator", () => {
      expect(teaserFirstLine("Costs fall. Then they rise.")).toBe("Costs fall.");
    });

    it("returns the whole string when there is no terminator", () => {
      expect(teaserFirstLine("No terminator here")).toBe("No terminator here");
    });

    it("breaks on the first newline before a period", () => {
      expect(teaserFirstLine("Line one\nLine two.")).toBe("Line one");
    });

    it("trims whitespace at the edges", () => {
      expect(teaserFirstLine("  Padded line. ")).toBe("Padded line.");
    });

    it("caps the output at 200 characters", () => {
      const long = "a".repeat(300);
      expect(teaserFirstLine(long).length).toBe(200);
    });
  });
});
