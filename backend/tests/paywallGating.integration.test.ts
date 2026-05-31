/* eslint-disable @typescript-eslint/no-explicit-any */
import request from "supertest";
import type { Redis } from "ioredis";
import { createMockDb } from "./helpers/mockDb";

const mock = createMockDb();

jest.mock("../src/db", () => ({
  __esModule: true,
  get db() {
    return mock.db;
  },
  schema: {},
  pool: {},
}));

// Redis mock at the lib boundary. The paywall service uses the same
// getRedis() seam as the rate limiter; we toggle redisInstance between
// the mock and null to exercise the configured and Redis-down branches.
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
> | null = null;

jest.mock("../src/lib/redis", () => ({
  __esModule: true,
  getRedis: () => redisInstance,
  isRedisConfigured: () => redisInstance !== null,
}));

import { createApp } from "../src/app";
import { generateToken } from "../src/services/authService";

const app = createApp();

function auth(token: string): [string, string] {
  return ["Authorization", `Bearer ${token}`];
}

const userId = "user-free-1";
const storyId = "11111111-1111-1111-1111-111111111111";

function setRedis(mockOn: boolean): void {
  if (mockOn) {
    redisInstance = {
      sismember: sismemberMock as unknown as Redis["sismember"],
      scard: scardMock as unknown as Redis["scard"],
      sadd: saddMock as unknown as Redis["sadd"],
      smembers: smembersMock as unknown as Redis["smembers"],
      expire: expireMock as unknown as Redis["expire"],
      ttl: ttlMock as unknown as Redis["ttl"],
      incr: incrMock as unknown as Redis["incr"],
    };
  } else {
    redisInstance = null;
  }
}

function resetAll(): void {
  mock.reset();
  sismemberMock.mockReset();
  scardMock.mockReset();
  saddMock.mockReset();
  smembersMock.mockReset();
  expireMock.mockReset();
  ttlMock.mockReset();
  incrMock.mockReset();
  setRedis(true);
}

function makeStoryRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: storyId,
    sector: "ai",
    headline: "Model release headline",
    context: "Context paragraph.",
    whyItMatters: "Costs collapse. Then they rise.",
    whyItMattersTemplate: null,
    sourceUrl: "https://example.com/post",
    sourceName: "Example",
    publishedAt: new Date("2026-05-01T00:00:00Z"),
    createdAt: new Date("2026-05-01T00:00:00Z"),
    authorId: "author-1",
    authorName: "Jane",
    authorBio: "Bio",
    isSaved: false,
    saveCount: 0,
    commentCount: 0,
    ...overrides,
  };
}

// Phase 12m — the feed is events-only, so feed tests stage event-shaped
// rows (the events query column set). `makeStoryRow` above is retained
// for the `/:id` detail-gating tests, which still read the stories table.
function makeEventRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: storyId,
    sector: "ai",
    headline: "Model release headline",
    context: "Context paragraph.",
    whyItMatters: "Costs collapse. Then they rise.",
    whyItMattersTemplate: null,
    genericCommentary: null,
    primarySourceUrl: "https://example.com/post",
    primarySourceName: "Example",
    imageUrl: null,
    publishedAt: new Date("2026-05-01T00:00:00Z"),
    createdAt: new Date("2026-05-01T00:00:00Z"),
    authorId: "author-1",
    authorName: "Jane",
    authorBio: "Bio",
    isSaved: false,
    saveCount: 0,
    commentCount: 0,
    effectiveScore: 8,
    ...overrides,
  };
}

const queueOnboarded = (): void => {
  mock.queueSelect([{ completedAt: new Date("2026-04-20T00:00:00Z") }]);
};
const queueTierFree = (): void => {
  // trial_started_at is set (post-trial-expiry free user) — CTA copy
  // branches to the "$10/month" message, not the trial offer.
  mock.queueSelect([{ tier: "free", trialStartedAt: new Date("2026-04-01T00:00:00Z") }]);
};

describe("Phase 12g paywall gating", () => {
  let token: string;
  beforeEach(() => {
    resetAll();
    token = generateToken(userId, "free@example.com");
  });

  describe("GET /api/v1/stories/feed — free-tier gating", () => {
    it("flags unviewed rows as gated when the user is at the daily cap", async () => {
      queueOnboarded();
      queueTierFree();
      // SMEMBERS returns 15 OTHER ids — user is at cap, this row is unviewed.
      const viewedIds = Array.from({ length: 15 }, (_, i) => `viewed-${i}`);
      smembersMock.mockResolvedValueOnce(viewedIds);
      // Phase 12m — events-only: profile, events, event_sources, count.
      mock.queueSelect([{ sectors: ["ai"], role: "engineer" }]);
      mock.queueSelect([makeEventRow()]);
      mock.queueSelect([]); // event_sources batch
      mock.queueSelect([{ count: 1 }]); // events count

      const res = await request(app)
        .get("/api/v1/stories/feed")
        .set(...auth(token));

      expect(res.status).toBe(200);
      expect(res.body.data.stories).toHaveLength(1);
      const row = res.body.data.stories[0];
      expect(row.gated).toBe(true);
      expect(row.gate_reason).toBe("story_limit");
      expect(row.id).toBe(storyId);
      expect(row.sector).toBe("ai");
      expect(row.teaser.headline).toBe("Model release headline");
      expect(row.teaser.first_line).toBe("Costs collapse.");
      expect(row.upgrade_cta.trial_available).toBe(false);
      expect(row.upgrade_cta.message).toContain("$10/month");
      // Gated card must not leak the body fields.
      expect(row.context).toBeUndefined();
      expect(row.why_it_matters).toBeUndefined();
    });

    it("does NOT gate rows that are already in the viewed set (re-reads)", async () => {
      queueOnboarded();
      queueTierFree();
      // 15 ids including storyId — user is at cap, but this story has
      // already been viewed today, so it stays unblurred.
      const viewedIds = [
        storyId,
        ...Array.from({ length: 14 }, (_, i) => `viewed-${i}`),
      ];
      smembersMock.mockResolvedValueOnce(viewedIds);
      mock.queueSelect([{ sectors: ["ai"], role: "engineer" }]);
      mock.queueSelect([makeEventRow()]);
      mock.queueSelect([]); // event_sources batch
      mock.queueSelect([{ count: 1 }]); // events count

      const res = await request(app)
        .get("/api/v1/stories/feed")
        .set(...auth(token));

      expect(res.body.data.stories[0].gated).toBe(false);
      expect(res.body.data.stories[0].headline).toBe("Model release headline");
    });

    it("does NOT gate saved rows even at cap (saved bypass)", async () => {
      queueOnboarded();
      queueTierFree();
      const viewedIds = Array.from({ length: 15 }, (_, i) => `viewed-${i}`);
      smembersMock.mockResolvedValueOnce(viewedIds);
      mock.queueSelect([{ sectors: ["ai"], role: "engineer" }]);
      mock.queueSelect([makeEventRow({ isSaved: true })]);
      mock.queueSelect([]); // event_sources batch
      mock.queueSelect([{ count: 1 }]); // events count

      const res = await request(app)
        .get("/api/v1/stories/feed")
        .set(...auth(token));

      expect(res.body.data.stories[0].gated).toBe(false);
      expect(res.body.data.stories[0].is_saved).toBe(true);
    });

    it("does NOT gate any rows when the user is under the cap", async () => {
      queueOnboarded();
      queueTierFree();
      smembersMock.mockResolvedValueOnce(["viewed-1", "viewed-2"]); // count=2, well under 15
      mock.queueSelect([{ sectors: ["ai"], role: "engineer" }]);
      mock.queueSelect([makeEventRow()]);
      mock.queueSelect([]); // event_sources batch
      mock.queueSelect([{ count: 1 }]); // events count

      const res = await request(app)
        .get("/api/v1/stories/feed")
        .set(...auth(token));

      expect(res.body.data.stories[0].gated).toBe(false);
    });

    it("fail-opens (no rows gated) when Redis is unavailable", async () => {
      setRedis(false);
      queueOnboarded();
      queueTierFree();
      mock.queueSelect([{ sectors: ["ai"], role: "engineer" }]);
      mock.queueSelect([makeEventRow()]);
      mock.queueSelect([]); // event_sources batch
      mock.queueSelect([{ count: 1 }]); // events count

      const res = await request(app)
        .get("/api/v1/stories/feed")
        .set(...auth(token));

      expect(res.status).toBe(200);
      expect(res.body.data.stories[0].gated).toBe(false);
      expect(smembersMock).not.toHaveBeenCalled();
    });
  });

  describe("GET /api/v1/stories/:id — free-tier gating", () => {
    it("admits the first view of an unviewed story and increments the set", async () => {
      queueTierFree();
      mock.queueSelect([{ role: "engineer" }]); // profile
      mock.queueSelect([makeStoryRow()]); // story
      sismemberMock.mockResolvedValueOnce(0); // not in set
      scardMock.mockResolvedValueOnce(3); // 3 viewed so far
      saddMock.mockResolvedValueOnce(1); // added
      ttlMock.mockResolvedValueOnce(40000); // healthy TTL — no re-anchor

      const res = await request(app)
        .get(`/api/v1/stories/${storyId}`)
        .set(...auth(token));

      expect(res.status).toBe(200);
      expect(res.body.data.story.gated).toBe(false);
      expect(res.body.data.story.headline).toBe("Model release headline");
      expect(saddMock).toHaveBeenCalledWith(expect.any(String), storyId);
    });

    it("returns the gate envelope when the user is at the cap on an unviewed story", async () => {
      queueTierFree();
      mock.queueSelect([{ role: "engineer" }]);
      mock.queueSelect([makeStoryRow()]);
      sismemberMock.mockResolvedValueOnce(0);
      scardMock.mockResolvedValueOnce(15); // at cap

      const res = await request(app)
        .get(`/api/v1/stories/${storyId}`)
        .set(...auth(token));

      expect(res.status).toBe(200);
      expect(res.body.data.story.gated).toBe(true);
      expect(res.body.data.story.gate_reason).toBe("story_limit");
      expect(res.body.data.story.teaser.headline).toBe("Model release headline");
      expect(res.body.data.story.teaser.first_line).toBe("Costs collapse.");
      expect(res.body.data.story.upgrade_cta.trial_available).toBe(false);
      expect(saddMock).not.toHaveBeenCalled();
    });

    it("re-admits an already-viewed story without burning another view", async () => {
      queueTierFree();
      mock.queueSelect([{ role: "engineer" }]);
      mock.queueSelect([makeStoryRow()]);
      sismemberMock.mockResolvedValueOnce(1); // already in set
      scardMock.mockResolvedValueOnce(15); // still at cap

      const res = await request(app)
        .get(`/api/v1/stories/${storyId}`)
        .set(...auth(token));

      expect(res.status).toBe(200);
      expect(res.body.data.story.gated).toBe(false);
      expect(res.body.data.story.headline).toBe("Model release headline");
      expect(saddMock).not.toHaveBeenCalled();
    });

    it("bypasses the cap entirely for saved stories", async () => {
      queueTierFree();
      mock.queueSelect([{ role: "engineer" }]);
      mock.queueSelect([makeStoryRow({ isSaved: true })]);
      // Redis must not be touched on the saved-bypass path.

      const res = await request(app)
        .get(`/api/v1/stories/${storyId}`)
        .set(...auth(token));

      expect(res.status).toBe(200);
      expect(res.body.data.story.gated).toBe(false);
      expect(res.body.data.story.is_saved).toBe(true);
      expect(sismemberMock).not.toHaveBeenCalled();
      expect(scardMock).not.toHaveBeenCalled();
    });

    it("fail-opens (returns full story) when Redis is unavailable", async () => {
      setRedis(false);
      queueTierFree();
      mock.queueSelect([{ role: "engineer" }]);
      mock.queueSelect([makeStoryRow()]);

      const res = await request(app)
        .get(`/api/v1/stories/${storyId}`)
        .set(...auth(token));

      expect(res.status).toBe(200);
      expect(res.body.data.story.gated).toBe(false);
      expect(res.body.data.story.headline).toBe("Model release headline");
    });
  });

  describe("GET /api/v1/stories/search — free-tier cap", () => {
    const queueOnboarded = (): void => {
      mock.queueSelect([{ completedAt: new Date("2026-04-20T00:00:00Z") }]);
    };

    it("admits the 3rd search of the day for a free user", async () => {
      queueOnboarded();
      queueTierFree();
      incrMock.mockResolvedValueOnce(3); // exactly at cap — still admitted
      mock.queueSelect([{ role: "engineer" }]);
      mock.queueSelect([]); // search results
      mock.queueSelect([{ count: 0 }]);

      const res = await request(app)
        .get("/api/v1/stories/search?q=models")
        .set(...auth(token));

      expect(res.status).toBe(200);
      expect(res.body.data.stories).toBeDefined();
      expect(res.body.data.gated).toBeUndefined();
    });

    it("returns the search-limit gate envelope on the 4th search", async () => {
      queueOnboarded();
      queueTierFree();
      incrMock.mockResolvedValueOnce(4); // over cap

      const res = await request(app)
        .get("/api/v1/stories/search?q=models")
        .set(...auth(token));

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        gated: true,
        gate_reason: "search_limit",
        teaser: {
          headline: "Search limit reached",
          first_line: expect.stringContaining("3 of 3"),
        },
        upgrade_cta: {
          trial_available: false,
          message: expect.stringContaining("$10/month"),
        },
      });
      // No DB select for the search results — gating short-circuits.
      expect(mock.state.selectResults).toHaveLength(0);
    });

    it("anchors TTL via EXPIRE on the first search of the day", async () => {
      queueOnboarded();
      queueTierFree();
      incrMock.mockResolvedValueOnce(1); // first INCR returns 1
      mock.queueSelect([{ role: "engineer" }]);
      mock.queueSelect([]);
      mock.queueSelect([{ count: 0 }]);

      await request(app)
        .get("/api/v1/stories/search?q=models")
        .set(...auth(token));

      expect(expireMock).toHaveBeenCalledTimes(1);
    });

    it("does NOT call INCR for a pro user (cap is free-only)", async () => {
      queueOnboarded();
      mock.queueSelect([{ tier: "pro", trialStartedAt: null }]);
      mock.queueSelect([{ role: "engineer" }]);
      mock.queueSelect([]);
      mock.queueSelect([{ count: 0 }]);

      const res = await request(app)
        .get("/api/v1/stories/search?q=models")
        .set(...auth(token));

      expect(res.status).toBe(200);
      expect(incrMock).not.toHaveBeenCalled();
    });

    it("fail-opens when Redis is unavailable", async () => {
      setRedis(false);
      queueOnboarded();
      queueTierFree();
      mock.queueSelect([{ role: "engineer" }]);
      mock.queueSelect([]);
      mock.queueSelect([{ count: 0 }]);

      const res = await request(app)
        .get("/api/v1/stories/search?q=models")
        .set(...auth(token));

      expect(res.status).toBe(200);
      expect(res.body.data.gated).toBeUndefined();
    });
  });
});
