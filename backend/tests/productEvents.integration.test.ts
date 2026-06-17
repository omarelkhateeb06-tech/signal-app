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

describe("POST /api/v1/events (product/funnel sink)", () => {
  beforeEach(() => {
    mock.reset();
  });

  it("accepts an anonymous event (202) and stores it with a null user_id", async () => {
    const res = await request(app)
      .post("/api/v1/events")
      .send({ event: "upgrade_viewed", props: { tier: "free" }, path: "/upgrade" });

    expect(res.status).toBe(202);
    expect(res.body.data.accepted).toBe(1);
    expect(mock.state.insertedValues).toHaveLength(1);
    const row = mock.state.insertedValues[0] as Record<string, unknown>;
    expect(row).toMatchObject({
      userId: null,
      eventType: "upgrade_viewed",
      path: "/upgrade",
    });
    expect(row.props).toMatchObject({ tier: "free" });
  });

  it("attributes the event to the user when a valid Bearer token is present", async () => {
    const token = generateToken(userId, email);
    const res = await request(app)
      .post("/api/v1/events")
      .set(...auth(token))
      .send({ event: "checkout_started", props: { plan: "monthly" } });

    expect(res.status).toBe(202);
    const row = mock.state.insertedValues[0] as Record<string, unknown>;
    expect(row).toMatchObject({ userId, eventType: "checkout_started" });
  });

  it("treats an invalid token as anonymous (still 202, null user_id)", async () => {
    const res = await request(app)
      .post("/api/v1/events")
      .set("Authorization", "Bearer not-a-real-token")
      .send({ event: "theme_toggled" });

    expect(res.status).toBe(202);
    const row = mock.state.insertedValues[0] as Record<string, unknown>;
    expect(row.userId).toBeNull();
  });

  it("retains the client timestamp in props as client_ts", async () => {
    await request(app)
      .post("/api/v1/events")
      .send({ event: "upgrade_viewed", ts: 1_750_000_000_000 });

    const row = mock.state.insertedValues[0] as Record<string, unknown>;
    expect(row.props).toMatchObject({ client_ts: 1_750_000_000_000 });
  });

  it("rejects a body with no event field (400)", async () => {
    const res = await request(app).post("/api/v1/events").send({ props: { a: 1 } });
    expect(res.status).toBe(400);
  });

  it("rejects an over-long event name (400)", async () => {
    const res = await request(app)
      .post("/api/v1/events")
      .send({ event: "x".repeat(65) });
    expect(res.status).toBe(400);
  });
});
