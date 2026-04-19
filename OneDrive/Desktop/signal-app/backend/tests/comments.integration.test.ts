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
const otherUserId = "user-2";
const email = "a@b.com";
const storyId = "11111111-1111-1111-1111-111111111111";
const commentId = "22222222-2222-2222-2222-222222222222";
const parentId = "33333333-3333-3333-3333-333333333333";

function commentRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: commentId,
    storyId,
    userId,
    parentCommentId: null,
    content: "Great story.",
    createdAt: new Date("2026-04-10T00:00:00Z"),
    updatedAt: new Date("2026-04-10T00:00:00Z"),
    deletedAt: null,
    authorName: "Ada",
    authorEmail: email,
    authorProfilePictureUrl: null,
    ...overrides,
  };
}

describe("comments endpoints", () => {
  let token: string;

  beforeEach(() => {
    mock.reset();
    token = generateToken(userId, email);
  });

  describe("POST /api/v1/stories/:story_id/comments", () => {
    it("returns 401 without a token", async () => {
      const res = await request(app)
        .post(`/api/v1/stories/${storyId}/comments`)
        .send({ content: "Hi" });
      expect(res.status).toBe(401);
    });

    it("rejects empty content", async () => {
      const res = await request(app)
        .post(`/api/v1/stories/${storyId}/comments`)
        .set(...auth(token))
        .send({ content: "  " });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_INPUT");
    });

    it("rejects content over 2000 chars", async () => {
      const res = await request(app)
        .post(`/api/v1/stories/${storyId}/comments`)
        .set(...auth(token))
        .send({ content: "x".repeat(2001) });
      expect(res.status).toBe(400);
    });

    it("returns 404 when the story does not exist", async () => {
      mock.queueSelect([]);
      const res = await request(app)
        .post(`/api/v1/stories/${storyId}/comments`)
        .set(...auth(token))
        .send({ content: "Nice." });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("STORY_NOT_FOUND");
    });

    it("creates a top-level comment and returns it with author info", async () => {
      mock.queueSelect([{ id: storyId }]);
      mock.queueInsert([{ id: commentId }]);
      mock.queueSelect([commentRow()]);

      const res = await request(app)
        .post(`/api/v1/stories/${storyId}/comments`)
        .set(...auth(token))
        .send({ content: "Great story." });

      expect(res.status).toBe(201);
      expect(res.body.data.comment.id).toBe(commentId);
      expect(res.body.data.comment.author.name).toBe("Ada");
      expect(res.body.data.comment.reply_count).toBe(0);
    });

    it("rejects a parent that belongs to a different story", async () => {
      mock.queueSelect([{ id: storyId }]);
      mock.queueSelect([{ id: parentId, storyId: "99999999-9999-9999-9999-999999999999" }]);

      const res = await request(app)
        .post(`/api/v1/stories/${storyId}/comments`)
        .set(...auth(token))
        .send({ content: "Reply.", parent_comment_id: parentId });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("PARENT_MISMATCH");
    });

    it("creates a reply when parent exists for the same story", async () => {
      mock.queueSelect([{ id: storyId }]);
      mock.queueSelect([{ id: parentId, storyId }]);
      mock.queueInsert([{ id: commentId }]);
      mock.queueSelect([commentRow({ parentCommentId: parentId })]);

      const res = await request(app)
        .post(`/api/v1/stories/${storyId}/comments`)
        .set(...auth(token))
        .send({ content: "Reply.", parent_comment_id: parentId });

      expect(res.status).toBe(201);
      expect(res.body.data.comment.parent_comment_id).toBe(parentId);
    });
  });

  describe("GET /api/v1/stories/:story_id/comments", () => {
    it("returns 401 without a token", async () => {
      const res = await request(app).get(`/api/v1/stories/${storyId}/comments`);
      expect(res.status).toBe(401);
    });

    it("returns top-level comments with reply_count", async () => {
      mock.queueSelect([{ id: storyId }]);
      mock.queueSelect([commentRow(), commentRow({ id: parentId })]);
      mock.queueSelect([{ count: 2 }]);
      mock.queueSelect([{ count: 3 }]); // reply_count for first
      mock.queueSelect([{ count: 0 }]); // reply_count for second

      const res = await request(app)
        .get(`/api/v1/stories/${storyId}/comments`)
        .set(...auth(token));

      expect(res.status).toBe(200);
      expect(res.body.data.comments).toHaveLength(2);
      expect(res.body.data.comments[0].reply_count).toBe(3);
      expect(res.body.data.comments[1].reply_count).toBe(0);
      expect(res.body.data.total).toBe(2);
    });

    it("hides deleted comment content", async () => {
      mock.queueSelect([{ id: storyId }]);
      mock.queueSelect([
        commentRow({ deletedAt: new Date("2026-04-11T00:00:00Z") }),
      ]);
      mock.queueSelect([{ count: 1 }]);
      mock.queueSelect([{ count: 0 }]);

      const res = await request(app)
        .get(`/api/v1/stories/${storyId}/comments`)
        .set(...auth(token));

      expect(res.status).toBe(200);
      expect(res.body.data.comments[0].is_deleted).toBe(true);
      expect(res.body.data.comments[0].content).toBe("[deleted]");
    });
  });

  describe("GET /api/v1/comments/:id/replies", () => {
    it("returns 404 when parent is missing", async () => {
      mock.queueSelect([]);
      const res = await request(app)
        .get(`/api/v1/comments/${parentId}/replies`)
        .set(...auth(token));
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("COMMENT_NOT_FOUND");
    });

    it("returns replies ordered ascending", async () => {
      mock.queueSelect([{ id: parentId }]);
      mock.queueSelect([
        commentRow({ id: commentId, parentCommentId: parentId }),
      ]);

      const res = await request(app)
        .get(`/api/v1/comments/${parentId}/replies`)
        .set(...auth(token));

      expect(res.status).toBe(200);
      expect(res.body.data.comments).toHaveLength(1);
      expect(res.body.data.comments[0].parent_comment_id).toBe(parentId);
    });
  });

  describe("DELETE /api/v1/comments/:id", () => {
    it("returns 404 when comment is missing", async () => {
      mock.queueSelect([]);
      const res = await request(app)
        .delete(`/api/v1/comments/${commentId}`)
        .set(...auth(token));
      expect(res.status).toBe(404);
    });

    it("returns 403 when a different user owns the comment", async () => {
      mock.queueSelect([
        { id: commentId, userId: otherUserId, deletedAt: null },
      ]);
      const res = await request(app)
        .delete(`/api/v1/comments/${commentId}`)
        .set(...auth(token));
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    });

    it("soft-deletes when owner requests it", async () => {
      mock.queueSelect([{ id: commentId, userId, deletedAt: null }]);

      const res = await request(app)
        .delete(`/api/v1/comments/${commentId}`)
        .set(...auth(token));

      expect(res.status).toBe(200);
      expect(mock.state.updatedRows).toHaveLength(1);
      const patch = mock.state.updatedRows[0] as { deletedAt?: unknown };
      expect(patch.deletedAt).toBeInstanceOf(Date);
    });
  });

  describe("PATCH /api/v1/comments/:id", () => {
    it("returns 400 for empty content", async () => {
      const res = await request(app)
        .patch(`/api/v1/comments/${commentId}`)
        .set(...auth(token))
        .send({ content: "" });
      expect(res.status).toBe(400);
    });

    it("returns 403 when not the owner", async () => {
      mock.queueSelect([
        { id: commentId, userId: otherUserId, deletedAt: null },
      ]);
      const res = await request(app)
        .patch(`/api/v1/comments/${commentId}`)
        .set(...auth(token))
        .send({ content: "Updated." });
      expect(res.status).toBe(403);
    });

    it("returns 410 when the comment has been deleted", async () => {
      mock.queueSelect([
        { id: commentId, userId, deletedAt: new Date() },
      ]);
      const res = await request(app)
        .patch(`/api/v1/comments/${commentId}`)
        .set(...auth(token))
        .send({ content: "Updated." });
      expect(res.status).toBe(410);
    });

    it("updates content and returns the updated comment", async () => {
      mock.queueSelect([{ id: commentId, userId, deletedAt: null }]);
      mock.queueSelect([commentRow({ content: "Updated." })]);

      const res = await request(app)
        .patch(`/api/v1/comments/${commentId}`)
        .set(...auth(token))
        .send({ content: "Updated." });

      expect(res.status).toBe(200);
      expect(res.body.data.comment.content).toBe("Updated.");
    });
  });
});
