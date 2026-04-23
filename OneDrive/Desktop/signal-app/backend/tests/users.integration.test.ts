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

describe("user profile endpoints", () => {
  const userId = "user-1";
  const email = "a@b.com";
  let token: string;

  beforeEach(() => {
    mock.reset();
    token = generateToken(userId, email);
  });

  describe("GET /api/v1/users/me/profile", () => {
    it("returns 401 without a token", async () => {
      const res = await request(app).get("/api/v1/users/me/profile");
      expect(res.status).toBe(401);
    });

    it("returns 401 with an invalid token", async () => {
      const res = await request(app)
        .get("/api/v1/users/me/profile")
        .set(...auth("not-a-valid-token"));
      expect(res.status).toBe(401);
    });

    it("returns user + profile for authenticated requests", async () => {
      mock.queueSelect([
        { id: userId, email, name: "Ada", profilePictureUrl: null },
      ]);
      mock.queueSelect([
        {
          userId,
          sectors: ["ai"],
          role: "engineer",
          goals: ["stay_current"],
          emailFrequency: "weekly",
          emailUnsubscribed: false,
          completedAt: new Date("2026-04-20T00:00:00Z"),
        },
      ]);
      // Phase 12b: the controller now also reads topic interests when
      // a profile row exists. Queue an empty list for a complete but
      // topic-less profile.
      mock.queueSelect([]);

      const res = await request(app)
        .get("/api/v1/users/me/profile")
        .set(...auth(token));
      expect(res.status).toBe(200);
      expect(res.body.data.user).toEqual({
        id: userId,
        email,
        name: "Ada",
        profilePictureUrl: null,
      });
      expect(res.body.data.profile).toMatchObject({
        userId,
        role: "engineer",
        emailFrequency: "weekly",
      });
      expect(res.body.data.topic_interests).toEqual([]);
      expect(res.body.data.onboarding_completed).toBe(true);
    });

    it("returns profile null when row does not exist", async () => {
      mock.queueSelect([{ id: userId, email, name: "Ada", profilePictureUrl: null }]);
      mock.queueSelect([]);
      const res = await request(app)
        .get("/api/v1/users/me/profile")
        .set(...auth(token));
      expect(res.status).toBe(200);
      expect(res.body.data.profile).toBeNull();
      expect(res.body.data.topic_interests).toEqual([]);
      expect(res.body.data.onboarding_completed).toBe(false);
    });

    it("reports onboarding_completed false when completed_at is null", async () => {
      mock.queueSelect([
        { id: userId, email, name: "Ada", profilePictureUrl: null },
      ]);
      // Profile row exists (e.g. from unsubscribe flow) but completed_at
      // is null — onboarding is NOT complete.
      mock.queueSelect([
        {
          userId,
          sectors: null,
          role: null,
          goals: null,
          emailFrequency: "weekly",
          emailUnsubscribed: true,
          completedAt: null,
        },
      ]);
      mock.queueSelect([]);

      const res = await request(app)
        .get("/api/v1/users/me/profile")
        .set(...auth(token));
      expect(res.status).toBe(200);
      expect(res.body.data.onboarding_completed).toBe(false);
    });

    it("returns 404 if user was deleted", async () => {
      mock.queueSelect([]);
      const res = await request(app)
        .get("/api/v1/users/me/profile")
        .set(...auth(token));
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("USER_NOT_FOUND");
    });
  });

  describe("PUT /api/v1/users/me/profile", () => {
    it("returns 401 without a token", async () => {
      const res = await request(app)
        .put("/api/v1/users/me/profile")
        .send({
          sectors: ["ai"],
          role: "engineer",
          goals: ["stay_informed"],
          email_frequency: "weekly",
        });
      expect(res.status).toBe(401);
    });

    it("returns 400 when sectors is empty", async () => {
      const res = await request(app)
        .put("/api/v1/users/me/profile")
        .set(...auth(token))
        .send({
          sectors: [],
          role: "engineer",
          goals: ["stay_informed"],
          email_frequency: "weekly",
        });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_INPUT");
    });

    it("returns 400 when email_frequency is invalid", async () => {
      const res = await request(app)
        .put("/api/v1/users/me/profile")
        .set(...auth(token))
        .send({
          sectors: ["ai"],
          role: "engineer",
          goals: ["stay_informed"],
          email_frequency: "yearly",
        });
      expect(res.status).toBe(400);
    });

    it("returns 400 when role is missing", async () => {
      const res = await request(app)
        .put("/api/v1/users/me/profile")
        .set(...auth(token))
        .send({
          sectors: ["ai"],
          goals: ["stay_informed"],
          email_frequency: "weekly",
        });
      expect(res.status).toBe(400);
    });

    it("updates an existing profile row", async () => {
      mock.queueSelect([{ userId }]); // existence check inside txn
      mock.queueInsert([
        {
          userId,
          sectors: ["ai", "finance"],
          role: "vc",
          goals: ["network", "find_opportunities"],
          emailFrequency: "daily",
          emailUnsubscribed: false,
        },
      ]); // update .returning()

      const res = await request(app)
        .put("/api/v1/users/me/profile")
        .set(...auth(token))
        .send({
          sectors: ["ai", "finance"],
          role: "vc",
          goals: ["network", "find_opportunities"],
          email_frequency: "daily",
        });

      expect(res.status).toBe(200);
      expect(res.body.data.profile.role).toBe("vc");
      expect(res.body.data.profile.sectors).toEqual(["ai", "finance"]);
      expect(res.body.data.profile.emailFrequency).toBe("daily");
    });

    it("inserts a new profile row when none exists", async () => {
      mock.queueSelect([]); // existence check: empty
      mock.queueInsert([
        {
          userId,
          sectors: ["ai"],
          role: "engineer",
          goals: ["deep_learning"],
          emailFrequency: "weekly",
          emailUnsubscribed: false,
        },
      ]); // insert .returning()

      const res = await request(app)
        .put("/api/v1/users/me/profile")
        .set(...auth(token))
        .send({
          sectors: ["ai"],
          role: "engineer",
          goals: ["deep_learning"],
          email_frequency: "weekly",
        });

      expect(res.status).toBe(200);
      expect(res.body.data.profile.userId).toBe(userId);
    });

    // Phase 12b: the settings page now edits `depth_preference`. The
    // column is optional on write (see userController.ts) but must be
    // persisted when supplied.
    it("accepts and persists depth_preference when supplied", async () => {
      mock.queueSelect([{ userId }]); // existence check inside txn
      mock.queueInsert([
        {
          userId,
          sectors: ["ai"],
          role: "engineer",
          goals: ["deep_learning"],
          emailFrequency: "weekly",
          emailUnsubscribed: false,
          depthPreference: "technical",
        },
      ]); // update .returning()

      const res = await request(app)
        .put("/api/v1/users/me/profile")
        .set(...auth(token))
        .send({
          sectors: ["ai"],
          role: "engineer",
          goals: ["deep_learning"],
          email_frequency: "weekly",
          depth_preference: "technical",
        });

      expect(res.status).toBe(200);
      expect(res.body.data.profile.depthPreference).toBe("technical");
    });

    it("rejects an invalid depth_preference value", async () => {
      const res = await request(app)
        .put("/api/v1/users/me/profile")
        .set(...auth(token))
        .send({
          sectors: ["ai"],
          role: "engineer",
          goals: ["deep_learning"],
          email_frequency: "weekly",
          depth_preference: "galaxy_brain",
        });
      expect(res.status).toBe(400);
    });
  });

  describe("PUT /api/v1/users/me", () => {
    it("returns 401 without a token", async () => {
      const res = await request(app).put("/api/v1/users/me").send({ name: "New" });
      expect(res.status).toBe(401);
    });

    it("returns 400 when body is empty", async () => {
      const res = await request(app)
        .put("/api/v1/users/me")
        .set(...auth(token))
        .send({});
      expect(res.status).toBe(400);
    });

    it("returns 400 when profile_picture_url is not a URL", async () => {
      const res = await request(app)
        .put("/api/v1/users/me")
        .set(...auth(token))
        .send({ profile_picture_url: "not-a-url" });
      expect(res.status).toBe(400);
    });

    it("updates the user and returns the updated row", async () => {
      mock.queueInsert([
        { id: userId, email, name: "Ada Lovelace", profilePictureUrl: null },
      ]);

      const res = await request(app)
        .put("/api/v1/users/me")
        .set(...auth(token))
        .send({ name: "Ada Lovelace" });

      expect(res.status).toBe(200);
      expect(res.body.data.user).toEqual({
        id: userId,
        email,
        name: "Ada Lovelace",
        profilePictureUrl: null,
      });
    });
  });
});
