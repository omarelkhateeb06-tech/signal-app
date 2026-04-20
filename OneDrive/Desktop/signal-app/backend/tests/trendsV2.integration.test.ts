import request from "supertest";
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

import { createApp } from "../src/app";
import { computeMomentum } from "../src/controllers/v2/trendsController";

const app = createApp();

const API_KEY = "sgnl_live_TEST_FIXTURE_NOT_A_REAL_KEY_abcde_xyz0";

function apiKeyHeader(value: string = API_KEY): [string, string] {
  return ["X-API-Key", value];
}

function queueAuthOk(): void {
  mock.queueSelect([
    { id: "key-1", userId: "user-1", label: "ci", revokedAt: null },
  ]);
}

function aggregateRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    period: "2026-W16",
    storyCount: 5,
    saveCount: 0,
    computedAt: new Date("2026-04-20T02:00:00Z"),
    ...overrides,
  };
}

describe("GET /api/v2/trends/:sector", () => {
  beforeEach(() => {
    mock.reset();
  });

  describe("computeMomentum (unit)", () => {
    it("returns null for series shorter than 2", () => {
      expect(computeMomentum([])).toBeNull();
      expect(computeMomentum([{ storyCount: 5 }])).toBeNull();
    });

    it("returns positive for up-week", () => {
      expect(computeMomentum([{ storyCount: 10 }, { storyCount: 5 }])).toBeCloseTo(1);
    });

    it("returns negative for down-week", () => {
      expect(computeMomentum([{ storyCount: 2 }, { storyCount: 4 }])).toBeCloseTo(-0.5);
    });

    it("floors last_week at 1 to avoid divide-by-zero on 0→N", () => {
      // last_week=0, this_week=5 → (5-0)/max(0,1) = 5
      expect(computeMomentum([{ storyCount: 5 }, { storyCount: 0 }])).toBe(5);
    });
  });

  describe("route", () => {
    it("returns 401 without an API key", async () => {
      const res = await request(app).get("/api/v2/trends/ai");
      expect(res.status).toBe(401);
    });

    it("rejects an unknown sector with 400 INVALID_SECTOR", async () => {
      queueAuthOk();
      const res = await request(app)
        .get("/api/v2/trends/biotech")
        .set(...apiKeyHeader());
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_SECTOR");
    });

    it("rejects weeks=1 (below min of 2)", async () => {
      queueAuthOk();
      const res = await request(app)
        .get("/api/v2/trends/ai?weeks=1")
        .set(...apiKeyHeader());
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_QUERY");
    });

    it("returns {sector, as_of, momentum, series} with a valid sector", async () => {
      queueAuthOk();
      mock.queueSelect([
        aggregateRow({ period: "2026-W16", storyCount: 10 }),
        aggregateRow({ period: "2026-W15", storyCount: 5 }),
      ]);

      const res = await request(app)
        .get("/api/v2/trends/ai?weeks=2")
        .set(...apiKeyHeader());

      expect(res.status).toBe(200);
      expect(res.body.data.sector).toBe("ai");
      expect(res.body.data.as_of).toBe("2026-04-20T02:00:00.000Z");
      expect(res.body.data.momentum).toBeCloseTo(1);
      expect(res.body.data.series).toEqual([
        { period: "2026-W16", story_count: 10, save_count: 0 },
        { period: "2026-W15", story_count: 5, save_count: 0 },
      ]);
    });

    it("returns momentum=null and as_of=null when no aggregates exist", async () => {
      queueAuthOk();
      mock.queueSelect([]);

      const res = await request(app)
        .get("/api/v2/trends/finance")
        .set(...apiKeyHeader());

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        sector: "finance",
        as_of: null,
        momentum: null,
        series: [],
      });
    });
  });
});
