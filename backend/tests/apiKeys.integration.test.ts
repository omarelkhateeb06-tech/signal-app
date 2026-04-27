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

describe("POST /api/v1/me/api-keys", () => {
  const userId = "user-1";
  const email = "a@b.com";
  let token: string;

  beforeEach(() => {
    mock.reset();
    token = generateToken(userId, email);
  });

  it("returns 401 without a token", async () => {
    const res = await request(app).post("/api/v1/me/api-keys").send({ label: "ci" });
    expect(res.status).toBe(401);
  });

  it("returns 400 when label is missing", async () => {
    const res = await request(app)
      .post("/api/v1/me/api-keys")
      .set(...auth(token))
      .send({});
    expect(res.status).toBe(400);
  });

  it("returns 400 when label is empty after trim", async () => {
    const res = await request(app)
      .post("/api/v1/me/api-keys")
      .set(...auth(token))
      .send({ label: "   " });
    expect(res.status).toBe(400);
  });

  it("creates a key and returns the full token exactly once", async () => {
    mock.queueSelect([]); // active count check: 0 keys
    mock.queueInsert([
      {
        id: "key-1",
        label: "ci",
        keyPrefix: "sgnl_live_TEST1",
        createdAt: new Date("2026-04-19T00:00:00Z"),
      },
    ]);

    const res = await request(app)
      .post("/api/v1/me/api-keys")
      .set(...auth(token))
      .send({ label: "ci" });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      id: "key-1",
      label: "ci",
    });
    expect(res.body.data.key).toMatch(/^sgnl_live_[A-Za-z0-9_-]{43}$/);
    expect(res.body.data.key_prefix).toBe("sgnl_live_TEST1");
  });

  it("returns 409 when the user already has 10 active keys", async () => {
    mock.queueSelect(Array.from({ length: 10 }, (_v, i) => ({ id: `k${i}` })));

    const res = await request(app)
      .post("/api/v1/me/api-keys")
      .set(...auth(token))
      .send({ label: "eleventh" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("API_KEY_LIMIT_REACHED");
  });
});

describe("GET /api/v1/me/api-keys", () => {
  const userId = "user-2";
  const email = "c@d.com";
  let token: string;

  beforeEach(() => {
    mock.reset();
    token = generateToken(userId, email);
  });

  it("returns 401 without a token", async () => {
    const res = await request(app).get("/api/v1/me/api-keys");
    expect(res.status).toBe(401);
  });

  it("returns the caller's keys with metadata (no full key value)", async () => {
    mock.queueSelect([
      {
        id: "key-a",
        label: "ci",
        keyPrefix: "sgnl_live_TEST1",
        createdAt: new Date("2026-04-18T00:00:00Z"),
        lastUsedAt: null,
        revokedAt: null,
      },
      {
        id: "key-b",
        label: "old",
        keyPrefix: "sgnl_live_TEST2",
        createdAt: new Date("2026-03-01T00:00:00Z"),
        lastUsedAt: new Date("2026-03-05T00:00:00Z"),
        revokedAt: new Date("2026-04-01T00:00:00Z"),
      },
    ]);

    const res = await request(app)
      .get("/api/v1/me/api-keys")
      .set(...auth(token));
    expect(res.status).toBe(200);
    expect(res.body.data.keys).toHaveLength(2);
    expect(res.body.data.keys[0]).toMatchObject({
      id: "key-a",
      label: "ci",
      key_prefix: "sgnl_live_TEST1",
      revoked_at: null,
    });
    expect(res.body.data.keys[0]).not.toHaveProperty("key");
    expect(res.body.data.keys[0]).not.toHaveProperty("key_hash");
  });
});

describe("DELETE /api/v1/me/api-keys/:id", () => {
  const userId = "user-3";
  const email = "e@f.com";
  let token: string;

  beforeEach(() => {
    mock.reset();
    token = generateToken(userId, email);
  });

  it("returns 401 without a token", async () => {
    const res = await request(app).delete("/api/v1/me/api-keys/11111111-1111-1111-1111-111111111111");
    expect(res.status).toBe(401);
  });

  it("returns 204 and issues a scoped update (by user_id + id + revoked_at IS NULL)", async () => {
    const res = await request(app)
      .delete("/api/v1/me/api-keys/11111111-1111-1111-1111-111111111111")
      .set(...auth(token));
    expect(res.status).toBe(204);
    expect(res.body).toEqual({});
    expect(mock.state.updatedRows).toHaveLength(1);
    expect(mock.state.updatedRows[0]).toMatchObject({ revokedAt: expect.any(Date) });
  });

  it("is idempotent: repeating DELETE still returns 204", async () => {
    const res1 = await request(app)
      .delete("/api/v1/me/api-keys/11111111-1111-1111-1111-111111111111")
      .set(...auth(token));
    expect(res1.status).toBe(204);

    const res2 = await request(app)
      .delete("/api/v1/me/api-keys/11111111-1111-1111-1111-111111111111")
      .set(...auth(token));
    expect(res2.status).toBe(204);
  });
});
