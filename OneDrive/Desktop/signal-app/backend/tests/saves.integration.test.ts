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

describe("saves endpoints", () => {
  let token: string;

  beforeEach(() => {
    mock.reset();
    token = generateToken(userId, email);
  });

  describe("POST /api/v1/stories/:id/save", () => {
    it("returns 401 without a token", async () => {
      const res = await request(app).post(`/api/v1/stories/${storyId}/save`);
      expect(res.status).toBe(401);
    });

    it("returns 404 when the story does not exist", async () => {
      mock.queueSelect([]);
      const res = await request(app)
        .post(`/api/v1/stories/${storyId}/save`)
        .set(...auth(token));
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("STORY_NOT_FOUND");
    });

    it("returns 400 for invalid UUID", async () => {
      const res = await request(app)
        .post("/api/v1/stories/not-a-uuid/save")
        .set(...auth(token));
      expect(res.status).toBe(400);
    });

    it("inserts the save and returns the new save_count", async () => {
      mock.queueSelect([{ id: storyId }]);
      mock.queueInsert([]);
      mock.queueSelect([{ count: 4 }]);

      const res = await request(app)
        .post(`/api/v1/stories/${storyId}/save`)
        .set(...auth(token));

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ saved: true, save_count: 4 });
    });

    it("is idempotent when the row already exists", async () => {
      mock.queueSelect([{ id: storyId }]);
      mock.queueInsert([]);
      mock.queueSelect([{ count: 1 }]);

      const res = await request(app)
        .post(`/api/v1/stories/${storyId}/save`)
        .set(...auth(token));

      expect(res.status).toBe(200);
      expect(res.body.data.saved).toBe(true);
    });
  });

  describe("DELETE /api/v1/stories/:id/save", () => {
    it("returns 401 without a token", async () => {
      const res = await request(app).delete(`/api/v1/stories/${storyId}/save`);
      expect(res.status).toBe(401);
    });

    it("deletes the save and returns the new save_count", async () => {
      mock.queueSelect([{ count: 0 }]);

      const res = await request(app)
        .delete(`/api/v1/stories/${storyId}/save`)
        .set(...auth(token));

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ saved: false, save_count: 0 });
      expect(mock.state.deletes).toHaveLength(1);
    });
  });

  describe("GET /api/v1/users/me/saves", () => {
    it("returns 401 without a token", async () => {
      const res = await request(app).get("/api/v1/users/me/saves");
      expect(res.status).toBe(401);
    });

    it("returns saved stories ordered by saved_at", async () => {
      mock.queueSelect([{ role: "engineer" }]);
      mock.queueSelect([
        {
          id: storyId,
          sector: "ai",
          headline: "Saved story",
          context: "x",
          whyItMatters: "y",
          whyItMattersTemplate: null,
          sourceUrl: "https://example.com",
          sourceName: "Example",
          publishedAt: new Date("2026-04-01T00:00:00Z"),
          createdAt: new Date("2026-04-01T00:00:00Z"),
          authorId: null,
          authorName: null,
          authorBio: null,
          isSaved: true,
          saveCount: 2,
          commentCount: 0,
          savedAt: new Date("2026-04-15T00:00:00Z"),
        },
      ]);
      mock.queueSelect([{ count: 1 }]);

      const res = await request(app)
        .get("/api/v1/users/me/saves")
        .set(...auth(token));

      expect(res.status).toBe(200);
      expect(res.body.data.stories).toHaveLength(1);
      expect(res.body.data.stories[0].id).toBe(storyId);
      expect(res.body.data.stories[0].is_saved).toBe(true);
      expect(res.body.data.stories[0].saved_at).toBeTruthy();
      expect(res.body.data.total).toBe(1);
      expect(res.body.data.has_more).toBe(false);
    });

    it("honors pagination params", async () => {
      mock.queueSelect([{ role: "vc" }]);
      mock.queueSelect([]);
      mock.queueSelect([{ count: 0 }]);

      const res = await request(app)
        .get("/api/v1/users/me/saves?limit=5&offset=10")
        .set(...auth(token));

      expect(res.status).toBe(200);
      expect(res.body.data.limit).toBe(5);
      expect(res.body.data.offset).toBe(10);
    });
  });
});
