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
      // Phase 12c: existence-check SELECT now projects the diff
      // columns (role/domain/seniority/sectors/goals/profileVersion).
      // When the diff detects a commentary-relevant change, patch
      // includes a bumped profileVersion.
      mock.queueSelect([
        {
          userId,
          role: "engineer",
          domain: null,
          seniority: null,
          sectors: ["ai"],
          goals: ["stay_current"],
          profileVersion: 3,
        },
      ]);
      mock.queueInsert([
        {
          userId,
          sectors: ["ai", "finance"],
          role: "vc",
          goals: ["network", "find_opportunities"],
          emailFrequency: "daily",
          emailUnsubscribed: false,
          profileVersion: 4,
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
      expect(res.body.data.profile.profileVersion).toBe(4);
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
      // depth_preference is NOT a commentary-relevant field — flipping
      // it alone must NOT bump profile_version.
      mock.queueSelect([
        {
          userId,
          role: "engineer",
          domain: null,
          seniority: null,
          sectors: ["ai"],
          goals: ["deep_learning"],
          profileVersion: 2,
        },
      ]);
      mock.queueInsert([
        {
          userId,
          sectors: ["ai"],
          role: "engineer",
          goals: ["deep_learning"],
          emailFrequency: "weekly",
          emailUnsubscribed: false,
          depthPreference: "technical",
          profileVersion: 2,
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
      expect(res.body.data.profile.profileVersion).toBe(2);
    });

    // Phase 12c — profile_version bump discipline. These tests pin
    // the three decisions that make commentary caching work:
    //   1. flipping a commentary-relevant field bumps
    //   2. flipping email-only fields does NOT bump
    //   3. supplying the same topic set in a different order is a no-op
    //      (set equality, not order equality)

    it("does NOT bump profile_version when only email fields change", async () => {
      // Same role/sectors/goals/no domain/no seniority → no
      // commentary-relevant delta → profileVersion stays put.
      mock.queueSelect([
        {
          userId,
          role: "engineer",
          domain: null,
          seniority: null,
          sectors: ["ai"],
          goals: ["stay_current"],
          profileVersion: 5,
        },
      ]);
      mock.queueInsert([
        {
          userId,
          sectors: ["ai"],
          role: "engineer",
          goals: ["stay_current"],
          emailFrequency: "daily",
          emailUnsubscribed: true,
          profileVersion: 5,
        },
      ]);

      const res = await request(app)
        .put("/api/v1/users/me/profile")
        .set(...auth(token))
        .send({
          sectors: ["ai"],
          role: "engineer",
          goals: ["stay_current"],
          email_frequency: "daily",
          email_unsubscribed: true,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.profile.profileVersion).toBe(5);
    });

    it("bumps profile_version when domain changes", async () => {
      mock.queueSelect([
        {
          userId,
          role: "engineer",
          domain: "ml_engineering",
          seniority: "senior",
          sectors: ["ai"],
          goals: ["stay_current"],
          profileVersion: 7,
        },
      ]);
      mock.queueInsert([
        {
          userId,
          sectors: ["ai"],
          role: "engineer",
          goals: ["stay_current"],
          domain: "ai_safety_alignment",
          seniority: "senior",
          profileVersion: 8,
        },
      ]);

      const res = await request(app)
        .put("/api/v1/users/me/profile")
        .set(...auth(token))
        .send({
          sectors: ["ai"],
          role: "engineer",
          goals: ["stay_current"],
          email_frequency: "weekly",
          domain: "ai_safety_alignment",
          seniority: "senior",
        });

      expect(res.status).toBe(200);
      expect(res.body.data.profile.profileVersion).toBe(8);
      expect(res.body.data.profile.domain).toBe("ai_safety_alignment");
    });

    it("bumps profile_version when topic_interests changes (set-wise)", async () => {
      // Existing row (no change to role/domain/etc).
      mock.queueSelect([
        {
          userId,
          role: "engineer",
          domain: "ml_engineering",
          seniority: "senior",
          sectors: ["ai"],
          goals: ["stay_current"],
          profileVersion: 1,
        },
      ]);
      // Existing topics: just "ai:agents".
      mock.queueSelect([{ sector: "ai", topic: "agents" }]);
      // Update .returning().
      mock.queueInsert([
        {
          userId,
          sectors: ["ai"],
          role: "engineer",
          goals: ["stay_current"],
          domain: "ml_engineering",
          seniority: "senior",
          profileVersion: 2,
        },
      ]);

      const res = await request(app)
        .put("/api/v1/users/me/profile")
        .set(...auth(token))
        .send({
          sectors: ["ai"],
          role: "engineer",
          goals: ["stay_current"],
          email_frequency: "weekly",
          domain: "ml_engineering",
          seniority: "senior",
          topic_interests: [
            { sector: "ai", topic: "agents" },
            { sector: "ai", topic: "foundation_models" },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.data.profile.profileVersion).toBe(2);
    });

    it("does NOT bump when topic_interests supplied in a different order with same set", async () => {
      // Existing: agents + foundation_models.
      mock.queueSelect([
        {
          userId,
          role: "engineer",
          domain: "ml_engineering",
          seniority: "senior",
          sectors: ["ai"],
          goals: ["stay_current"],
          profileVersion: 9,
        },
      ]);
      mock.queueSelect([
        { sector: "ai", topic: "agents" },
        { sector: "ai", topic: "foundation_models" },
      ]);
      mock.queueInsert([
        {
          userId,
          sectors: ["ai"],
          role: "engineer",
          goals: ["stay_current"],
          domain: "ml_engineering",
          seniority: "senior",
          profileVersion: 9,
        },
      ]);

      const res = await request(app)
        .put("/api/v1/users/me/profile")
        .set(...auth(token))
        .send({
          sectors: ["ai"],
          role: "engineer",
          goals: ["stay_current"],
          email_frequency: "weekly",
          domain: "ml_engineering",
          seniority: "senior",
          // Same set, reversed order — set equality should short-circuit.
          topic_interests: [
            { sector: "ai", topic: "foundation_models" },
            { sector: "ai", topic: "agents" },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.data.profile.profileVersion).toBe(9);
    });

    it("rejects an unknown topic for a given sector", async () => {
      const res = await request(app)
        .put("/api/v1/users/me/profile")
        .set(...auth(token))
        .send({
          sectors: ["ai"],
          role: "engineer",
          goals: ["stay_current"],
          email_frequency: "weekly",
          topic_interests: [{ sector: "ai", topic: "not_a_real_topic" }],
        });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_INPUT");
    });

    it("rejects an invalid domain value", async () => {
      const res = await request(app)
        .put("/api/v1/users/me/profile")
        .set(...auth(token))
        .send({
          sectors: ["ai"],
          role: "engineer",
          goals: ["stay_current"],
          email_frequency: "weekly",
          domain: "definitely_not_a_domain",
        });
      expect(res.status).toBe(400);
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
