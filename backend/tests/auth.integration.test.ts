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
import { generateToken, hashPassword } from "../src/services/authService";

const app = createApp();

describe("auth endpoints", () => {
  beforeEach(() => {
    mock.reset();
  });

  describe("POST /api/v1/auth/signup", () => {
    it("rejects invalid email", async () => {
      const res = await request(app)
        .post("/api/v1/auth/signup")
        .send({ email: "not-an-email", password: "password123", name: "Ada" });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_INPUT");
    });

    it("rejects short password", async () => {
      const res = await request(app)
        .post("/api/v1/auth/signup")
        .send({ email: "a@b.com", password: "short", name: "Ada" });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_INPUT");
    });

    it("rejects empty name", async () => {
      const res = await request(app)
        .post("/api/v1/auth/signup")
        .send({ email: "a@b.com", password: "password123", name: "" });
      expect(res.status).toBe(400);
    });

    it("creates a user and returns a token", async () => {
      mock.queueSelect([]); // existence check: no rows
      mock.queueInsert([{ id: "user-1", email: "a@b.com", name: "Ada" }]); // insert users
      mock.queueInsert([]); // insert user_profiles

      const res = await request(app)
        .post("/api/v1/auth/signup")
        .send({ email: "a@b.com", password: "password123", name: "Ada" });

      expect(res.status).toBe(201);
      expect(res.body.data.user).toEqual({ id: "user-1", email: "a@b.com", name: "Ada" });
      expect(typeof res.body.data.token).toBe("string");
      expect(res.body.data.token.split(".")).toHaveLength(3);
    });

    it("returns 409 when email already exists", async () => {
      mock.queueSelect([{ id: "existing-user" }]);
      const res = await request(app)
        .post("/api/v1/auth/signup")
        .send({ email: "a@b.com", password: "password123", name: "Ada" });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("EMAIL_TAKEN");
    });
  });

  describe("POST /api/v1/auth/login", () => {
    it("rejects invalid email format", async () => {
      const res = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: "bad", password: "password123" });
      expect(res.status).toBe(400);
    });

    it("returns 401 when user does not exist", async () => {
      mock.queueSelect([]);
      const res = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: "a@b.com", password: "password123" });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
    });

    it("returns 401 for wrong password", async () => {
      const passwordHash = await hashPassword("correct-password");
      mock.queueSelect([
        { id: "u1", email: "a@b.com", name: "Ada", passwordHash, status: "active" },
      ]);
      const res = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: "a@b.com", password: "wrong-password" });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
    });

    it("returns 403 when account is inactive", async () => {
      const passwordHash = await hashPassword("correct-password");
      mock.queueSelect([
        { id: "u1", email: "a@b.com", name: "Ada", passwordHash, status: "inactive" },
      ]);
      const res = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: "a@b.com", password: "correct-password" });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("ACCOUNT_INACTIVE");
    });

    it("issues a token on correct credentials and updates last_login_at", async () => {
      const passwordHash = await hashPassword("correct-password");
      mock.queueSelect([
        { id: "u1", email: "a@b.com", name: "Ada", passwordHash, status: "active" },
      ]);
      const res = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: "a@b.com", password: "correct-password" });

      expect(res.status).toBe(200);
      expect(res.body.data.user).toEqual({ id: "u1", email: "a@b.com", name: "Ada" });
      expect(typeof res.body.data.token).toBe("string");
      expect(mock.state.updatedRows).toHaveLength(1);
      expect(mock.state.updatedRows[0]).toHaveProperty("lastLoginAt");
    });
  });

  describe("GET /api/v1/auth/me", () => {
    it("returns 401 with no Authorization header", async () => {
      const res = await request(app).get("/api/v1/auth/me");
      expect(res.status).toBe(401);
    });

    it("returns 401 with an invalid token", async () => {
      const res = await request(app)
        .get("/api/v1/auth/me")
        .set("Authorization", "Bearer not-a-real-token");
      expect(res.status).toBe(401);
    });

    it("returns 401 with a malformed Authorization header", async () => {
      const res = await request(app)
        .get("/api/v1/auth/me")
        .set("Authorization", "garbage");
      expect(res.status).toBe(401);
    });

    it("returns the current user with a valid token", async () => {
      const token = generateToken("u1", "a@b.com");
      mock.queueSelect([{ id: "u1", email: "a@b.com", name: "Ada" }]);
      mock.queueSelect([]); // no profile row

      const res = await request(app)
        .get("/api/v1/auth/me")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.user).toEqual({ id: "u1", email: "a@b.com", name: "Ada" });
      expect(res.body.data.profile).toBeNull();
    });
  });

  describe("POST /api/v1/auth/logout", () => {
    it("returns success without requiring auth (frontend clears token)", async () => {
      const res = await request(app).post("/api/v1/auth/logout");
      expect(res.status).toBe(200);
      expect(res.body.data.success).toBe(true);
    });
  });
});
