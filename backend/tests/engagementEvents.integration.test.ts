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
const eventId = "33333333-3333-3333-3333-333333333333";

describe("POST /api/v1/engagement/events", () => {
  let token: string;

  beforeEach(() => {
    mock.reset();
    token = generateToken(userId, email);
  });

  it("accepts a batch (202) and fans out one insert with the mapped rows", async () => {
    const res = await request(app)
      .post("/api/v1/engagement/events")
      .set(...auth(token))
      .send({
        events: [
          { event_type: "story_view", event_id: eventId, dwell_ms: 4200 },
          { event_type: "click_through", event_id: eventId, metadata: { target: "source" } },
          { event_type: "share", event_id: eventId },
        ],
      });

    expect(res.status).toBe(202);
    expect(res.body.data.accepted).toBe(3);
    // One db.insert(...).values([...]) call carrying all three rows.
    expect(mock.state.insertedValues).toHaveLength(1);
    const rows = mock.state.insertedValues[0] as Record<string, unknown>[];
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      userId,
      eventType: "story_view",
      eventId,
      dwellMs: 4200,
    });
    // Absent optional fields normalize to null, not undefined.
    expect(rows[2]).toMatchObject({ eventType: "share", dwellMs: null });
  });

  it("honors a client occurred_at for late-flushed beacons", async () => {
    const occurred = "2026-06-01T12:00:00.000Z";
    await request(app)
      .post("/api/v1/engagement/events")
      .set(...auth(token))
      .send({ events: [{ event_type: "story_view", occurred_at: occurred }] });

    const rows = mock.state.insertedValues[0] as Record<string, unknown>[];
    expect(rows[0].createdAt).toEqual(new Date(occurred));
  });

  it("rejects an empty batch (400)", async () => {
    const res = await request(app)
      .post("/api/v1/engagement/events")
      .set(...auth(token))
      .send({ events: [] });
    expect(res.status).toBe(400);
  });

  it("rejects a non-uuid event_id (400)", async () => {
    const res = await request(app)
      .post("/api/v1/engagement/events")
      .set(...auth(token))
      .send({ events: [{ event_type: "story_view", event_id: "not-a-uuid" }] });
    expect(res.status).toBe(400);
  });

  it("requires authentication (401)", async () => {
    const res = await request(app)
      .post("/api/v1/engagement/events")
      .send({ events: [{ event_type: "story_view" }] });
    expect(res.status).toBe(401);
  });
});
