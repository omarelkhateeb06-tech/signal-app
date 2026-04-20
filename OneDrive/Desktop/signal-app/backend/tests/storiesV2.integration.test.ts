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

const app = createApp();

const API_KEY = "sgnl_live_TEST_FIXTURE_NOT_A_REAL_KEY_abcde_xyz0";

function apiKeyHeader(value: string = API_KEY): [string, string] {
  return ["X-API-Key", value];
}

function queueAuthOk(apiKeyId: string = "key-1", userId: string = "user-1"): void {
  // apiKeyAuth select — lookup by hash, filter revoked.
  mock.queueSelect([{ id: apiKeyId, userId, label: "ci", revokedAt: null }]);
}

function queueAuthMiss(): void {
  mock.queueSelect([]);
}

function makeStoryRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    headline: "New frontier model released",
    summary: "Context text explaining the story.",
    url: "https://example.com/post",
    publishedAt: new Date("2026-04-10T12:00:00Z"),
    sector: "ai",
    ...overrides,
  };
}

describe("GET /api/v2/stories", () => {
  beforeEach(() => {
    mock.reset();
  });

  describe("auth chain", () => {
    it("returns 401 when X-API-Key header is missing", async () => {
      const res = await request(app).get("/api/v2/stories");
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHORIZED");
    });

    it("returns 401 when the key is unknown or revoked", async () => {
      queueAuthMiss();
      const res = await request(app)
        .get("/api/v2/stories")
        .set(...apiKeyHeader("sgnl_live_TEST_FIXTURE_UNKNOWN_KEY_abcde_xyz000"));
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHORIZED");
    });

    it("returns 200 with a valid key", async () => {
      queueAuthOk();
      mock.queueSelect([makeStoryRow()]);

      const res = await request(app)
        .get("/api/v2/stories")
        .set(...apiKeyHeader());

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });
  });

  describe("response shape", () => {
    it("returns exactly id/headline/summary/url/published_at/sector fields", async () => {
      queueAuthOk();
      mock.queueSelect([makeStoryRow()]);

      const res = await request(app)
        .get("/api/v2/stories")
        .set(...apiKeyHeader());

      expect(res.status).toBe(200);
      expect(Object.keys(res.body.data[0]).sort()).toEqual([
        "headline",
        "id",
        "published_at",
        "sector",
        "summary",
        "url",
      ]);
      expect(res.body.pagination).toMatchObject({
        next_cursor: null,
        has_more: false,
      });
    });
  });

  describe("filters", () => {
    it("accepts a valid sector filter", async () => {
      queueAuthOk();
      mock.queueSelect([makeStoryRow({ sector: "finance" })]);

      const res = await request(app)
        .get("/api/v2/stories?sector=finance")
        .set(...apiKeyHeader());

      expect(res.status).toBe(200);
      expect(res.body.data[0].sector).toBe("finance");
    });

    it("rejects an unknown sector with 400 INVALID_QUERY", async () => {
      queueAuthOk();
      const res = await request(app)
        .get("/api/v2/stories?sector=biotech")
        .set(...apiKeyHeader());

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_QUERY");
    });

    it("accepts ISO-8601 since/until datetimes", async () => {
      queueAuthOk();
      mock.queueSelect([makeStoryRow()]);

      const res = await request(app)
        .get(
          "/api/v2/stories?since=2026-04-01T00:00:00Z&until=2026-04-30T00:00:00Z",
        )
        .set(...apiKeyHeader());

      expect(res.status).toBe(200);
    });

    it("rejects a non-ISO since value", async () => {
      queueAuthOk();
      const res = await request(app)
        .get("/api/v2/stories?since=yesterday")
        .set(...apiKeyHeader());

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_QUERY");
    });

    it("accepts a UUID author filter", async () => {
      queueAuthOk();
      mock.queueSelect([makeStoryRow()]);

      const res = await request(app)
        .get("/api/v2/stories?author=22222222-2222-2222-2222-222222222222")
        .set(...apiKeyHeader());

      expect(res.status).toBe(200);
    });

    it("rejects a non-UUID author", async () => {
      queueAuthOk();
      const res = await request(app)
        .get("/api/v2/stories?author=not-a-uuid")
        .set(...apiKeyHeader());

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_QUERY");
    });

    it("rejects limit=0 (below min)", async () => {
      queueAuthOk();
      const res = await request(app)
        .get("/api/v2/stories?limit=0")
        .set(...apiKeyHeader());

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_QUERY");
    });

    it("rejects limit above MAX_LIMIT (100)", async () => {
      queueAuthOk();
      const res = await request(app)
        .get("/api/v2/stories?limit=500")
        .set(...apiKeyHeader());

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_QUERY");
    });
  });

  describe("pagination", () => {
    it("sets has_more=false and next_cursor=null when rows < limit", async () => {
      queueAuthOk();
      mock.queueSelect([makeStoryRow(), makeStoryRow({ id: "22222222-2222-2222-2222-222222222222" })]);

      const res = await request(app)
        .get("/api/v2/stories?limit=50")
        .set(...apiKeyHeader());

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.pagination.has_more).toBe(false);
      expect(res.body.pagination.next_cursor).toBeNull();
    });

    it("sets has_more=true and emits a cursor when rows > limit", async () => {
      queueAuthOk();
      // limit=2 → controller fetches 3; slice to 2, signal has_more=true.
      mock.queueSelect([
        makeStoryRow({ id: "11111111-1111-1111-1111-111111111111" }),
        makeStoryRow({ id: "22222222-2222-2222-2222-222222222222" }),
        makeStoryRow({ id: "33333333-3333-3333-3333-333333333333" }),
      ]);

      const res = await request(app)
        .get("/api/v2/stories?limit=2")
        .set(...apiKeyHeader());

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.pagination.has_more).toBe(true);
      expect(res.body.pagination.next_cursor).toEqual(expect.any(String));
      expect(res.body.pagination.next_cursor.length).toBeGreaterThan(0);
    });

    it("accepts a valid cursor emitted from a previous page", async () => {
      queueAuthOk();
      mock.queueSelect([
        makeStoryRow({ id: "11111111-1111-1111-1111-111111111111" }),
        makeStoryRow({ id: "22222222-2222-2222-2222-222222222222" }),
        makeStoryRow({ id: "33333333-3333-3333-3333-333333333333" }),
      ]);

      const first = await request(app)
        .get("/api/v2/stories?limit=2")
        .set(...apiKeyHeader());
      expect(first.status).toBe(200);
      const cursor = first.body.pagination.next_cursor as string;

      queueAuthOk();
      mock.queueSelect([makeStoryRow({ id: "33333333-3333-3333-3333-333333333333" })]);

      const second = await request(app)
        .get(`/api/v2/stories?limit=2&cursor=${encodeURIComponent(cursor)}`)
        .set(...apiKeyHeader());

      expect(second.status).toBe(200);
      expect(second.body.data).toHaveLength(1);
      expect(second.body.pagination.has_more).toBe(false);
      expect(second.body.pagination.next_cursor).toBeNull();
    });

    it("rejects a malformed cursor with 400 INVALID_CURSOR", async () => {
      queueAuthOk();
      const res = await request(app)
        .get("/api/v2/stories?cursor=not-a-real-cursor")
        .set(...apiKeyHeader());

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_CURSOR");
    });

    it("rejects a base64url-but-not-JSON cursor with 400 INVALID_CURSOR", async () => {
      queueAuthOk();
      const garbage = Buffer.from("not json at all", "utf8").toString("base64url");
      const res = await request(app)
        .get(`/api/v2/stories?cursor=${garbage}`)
        .set(...apiKeyHeader());

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_CURSOR");
    });
  });
});
