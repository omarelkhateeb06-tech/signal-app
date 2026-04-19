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
import { signUnsubscribeToken } from "../src/services/unsubscribeService";

const app = createApp();

function auth(token: string): [string, string] {
  return ["Authorization", `Bearer ${token}`];
}

describe("email endpoints", () => {
  beforeEach(() => {
    mock.reset();
  });

  describe("POST /api/v1/emails/unsubscribe", () => {
    it("marks the user unsubscribed with a valid token", async () => {
      const token = signUnsubscribeToken("user-1");
      mock.queueSelect([{ id: "user-1", email: "a@b.com" }]);
      mock.queueInsert([{ userId: "user-1", emailUnsubscribed: true }]);
      const res = await request(app)
        .post("/api/v1/emails/unsubscribe")
        .send({ token });
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ email: "a@b.com", unsubscribed: true });
    });

    it("rejects an invalid token", async () => {
      const res = await request(app)
        .post("/api/v1/emails/unsubscribe")
        .send({ token: "not-a-valid-token" });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_TOKEN");
    });

    it("rejects a missing token", async () => {
      const res = await request(app).post("/api/v1/emails/unsubscribe").send({});
      expect(res.status).toBe(400);
    });

    it("returns 404 if the user no longer exists", async () => {
      const token = signUnsubscribeToken("ghost-user");
      mock.queueSelect([]);
      const res = await request(app)
        .post("/api/v1/emails/unsubscribe")
        .send({ token });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("USER_NOT_FOUND");
    });

    it("supports GET with the token as a query param", async () => {
      const token = signUnsubscribeToken("user-1");
      mock.queueSelect([{ id: "user-1", email: "a@b.com" }]);
      mock.queueInsert([{ userId: "user-1", emailUnsubscribed: true }]);
      const res = await request(app)
        .get(`/api/v1/emails/unsubscribe?token=${encodeURIComponent(token)}`);
      expect(res.status).toBe(200);
      expect(res.body.data.unsubscribed).toBe(true);
    });
  });

  describe("PUT /api/v1/emails/preferences", () => {
    const userId = "user-1";
    const email = "a@b.com";
    let token: string;

    beforeEach(() => {
      token = generateToken(userId, email);
    });

    it("requires auth", async () => {
      const res = await request(app)
        .put("/api/v1/emails/preferences")
        .send({ email_frequency: "weekly" });
      expect(res.status).toBe(401);
    });

    it("updates an existing profile", async () => {
      mock.queueSelect([{ userId }]);
      mock.queueInsert([
        { userId, emailFrequency: "weekly", emailUnsubscribed: false },
      ]);
      const res = await request(app)
        .put("/api/v1/emails/preferences")
        .set(...auth(token))
        .send({ email_frequency: "weekly", email_unsubscribed: false });
      expect(res.status).toBe(200);
      expect(res.body.data.profile).toEqual({
        email_frequency: "weekly",
        email_unsubscribed: false,
      });
    });

    it("creates a profile row when one doesn't exist", async () => {
      mock.queueSelect([]);
      mock.queueInsert([
        { userId, emailFrequency: "never", emailUnsubscribed: false },
      ]);
      const res = await request(app)
        .put("/api/v1/emails/preferences")
        .set(...auth(token))
        .send({ email_frequency: "never" });
      expect(res.status).toBe(200);
      expect(res.body.data.profile.email_frequency).toBe("never");
    });

    it("rejects invalid frequency", async () => {
      const res = await request(app)
        .put("/api/v1/emails/preferences")
        .set(...auth(token))
        .send({ email_frequency: "hourly" });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_INPUT");
    });

    it("rejects an empty body", async () => {
      const res = await request(app)
        .put("/api/v1/emails/preferences")
        .set(...auth(token))
        .send({});
      expect(res.status).toBe(400);
    });
  });
});
