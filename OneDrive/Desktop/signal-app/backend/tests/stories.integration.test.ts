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
import { generateToken } from "../src/services/authService";

const app = createApp();

function auth(token: string): [string, string] {
  return ["Authorization", `Bearer ${token}`];
}

const userId = "user-1";
const email = "reader@example.com";
const storyId = "11111111-1111-1111-1111-111111111111";

function makeRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: storyId,
    sector: "ai",
    headline: "New frontier model released",
    context: "Context text.",
    whyItMatters: "Costs fall.",
    whyItMattersTemplate: null,
    sourceUrl: "https://example.com/post",
    sourceName: "Example",
    publishedAt: new Date("2026-04-01T00:00:00Z"),
    createdAt: new Date("2026-04-01T00:00:00Z"),
    authorId: "author-1",
    authorName: "Jane Writer",
    authorBio: "Bio",
    isSaved: false,
    saveCount: 3,
    commentCount: 1,
    ...overrides,
  };
}

describe("stories endpoints", () => {
  let token: string;

  beforeEach(() => {
    mock.reset();
    token = generateToken(userId, email);
  });

  describe("GET /api/v1/stories/feed", () => {
    it("returns 401 without a token", async () => {
      const res = await request(app).get("/api/v1/stories/feed");
      expect(res.status).toBe(401);
    });

    it("returns empty feed when user has no sectors and none are requested", async () => {
      mock.queueSelect([{ sectors: [], role: "engineer" }]);

      const res = await request(app)
        .get("/api/v1/stories/feed")
        .set(...auth(token));

      expect(res.status).toBe(200);
      expect(res.body.data.stories).toEqual([]);
      expect(res.body.data.total).toBe(0);
      expect(res.body.data.has_more).toBe(false);
    });

    it("uses the user's profile sectors when query is empty", async () => {
      mock.queueSelect([{ sectors: ["ai"], role: "engineer" }]);
      mock.queueSelect([makeRow()]);
      mock.queueSelect([{ count: 1 }]);

      const res = await request(app)
        .get("/api/v1/stories/feed")
        .set(...auth(token));

      expect(res.status).toBe(200);
      expect(res.body.data.stories).toHaveLength(1);
      expect(res.body.data.stories[0].sector).toBe("ai");
      expect(res.body.data.stories[0].why_it_matters_to_you).toContain(
        "As an engineer",
      );
      expect(res.body.data.total).toBe(1);
      expect(res.body.data.has_more).toBe(false);
    });

    it("filters by query sectors when provided", async () => {
      mock.queueSelect([{ sectors: ["ai"], role: "vc" }]);
      mock.queueSelect([makeRow({ sector: "finance" })]);
      mock.queueSelect([{ count: 1 }]);

      const res = await request(app)
        .get("/api/v1/stories/feed?sectors=finance")
        .set(...auth(token));

      expect(res.status).toBe(200);
      expect(res.body.data.stories[0].sector).toBe("finance");
      expect(res.body.data.stories[0].why_it_matters_to_you).toContain(
        "As an investor",
      );
    });

    it("reports has_more when offset+rows < total", async () => {
      mock.queueSelect([{ sectors: ["ai"], role: "engineer" }]);
      mock.queueSelect([makeRow(), makeRow({ id: "22222222-2222-2222-2222-222222222222" })]);
      mock.queueSelect([{ count: 10 }]);

      const res = await request(app)
        .get("/api/v1/stories/feed?limit=2&offset=0")
        .set(...auth(token));

      expect(res.status).toBe(200);
      expect(res.body.data.stories).toHaveLength(2);
      expect(res.body.data.total).toBe(10);
      expect(res.body.data.has_more).toBe(true);
      expect(res.body.data.limit).toBe(2);
      expect(res.body.data.offset).toBe(0);
    });

    it("rejects invalid limit values", async () => {
      const res = await request(app)
        .get("/api/v1/stories/feed?limit=0")
        .set(...auth(token));
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_INPUT");
    });
  });

  describe("GET /api/v1/stories/:id", () => {
    it("returns 401 without a token", async () => {
      const res = await request(app).get(`/api/v1/stories/${storyId}`);
      expect(res.status).toBe(401);
    });

    it("returns 400 for invalid UUID", async () => {
      const res = await request(app)
        .get("/api/v1/stories/not-a-uuid")
        .set(...auth(token));
      expect(res.status).toBe(400);
    });

    it("returns 404 when story is missing", async () => {
      mock.queueSelect([{ role: "engineer" }]);
      mock.queueSelect([]);

      const res = await request(app)
        .get(`/api/v1/stories/${storyId}`)
        .set(...auth(token));

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("STORY_NOT_FOUND");
    });

    it("returns the story with personalized why_it_matters_to_you", async () => {
      mock.queueSelect([{ role: "founder" }]);
      mock.queueSelect([
        makeRow({
          whyItMattersTemplate: "{role_phrase} — so this is actionable.",
        }),
      ]);

      const res = await request(app)
        .get(`/api/v1/stories/${storyId}`)
        .set(...auth(token));

      expect(res.status).toBe(200);
      expect(res.body.data.story.id).toBe(storyId);
      expect(res.body.data.story.why_it_matters_to_you).toContain("As a founder");
      expect(res.body.data.story.why_it_matters_to_you).toContain(
        "so this is actionable",
      );
      expect(res.body.data.story.author).toEqual({
        id: "author-1",
        name: "Jane Writer",
        bio: "Bio",
      });
    });
  });

  describe("GET /api/v1/stories/:id/related", () => {
    it("returns 401 without a token", async () => {
      const res = await request(app).get(`/api/v1/stories/${storyId}/related`);
      expect(res.status).toBe(401);
    });

    it("returns 404 when base story is missing", async () => {
      mock.queueSelect([]);

      const res = await request(app)
        .get(`/api/v1/stories/${storyId}/related`)
        .set(...auth(token));

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("STORY_NOT_FOUND");
    });

    it("returns same-sector stories excluding the current one", async () => {
      mock.queueSelect([{ id: storyId, sector: "ai" }]);
      mock.queueSelect([{ role: "engineer" }]);
      mock.queueSelect([
        makeRow({ id: "22222222-2222-2222-2222-222222222222" }),
        makeRow({ id: "33333333-3333-3333-3333-333333333333" }),
      ]);

      const res = await request(app)
        .get(`/api/v1/stories/${storyId}/related`)
        .set(...auth(token));

      expect(res.status).toBe(200);
      expect(res.body.data.stories).toHaveLength(2);
      expect(res.body.data.stories[0].id).not.toBe(storyId);
      expect(res.body.data.stories[0].why_it_matters_to_you).toContain(
        "As an engineer",
      );
    });
  });
});
