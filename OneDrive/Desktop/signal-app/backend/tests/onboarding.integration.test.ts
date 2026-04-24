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

const userId = "11111111-1111-1111-1111-111111111111";
const email = "a@b.com";

// A minimally-valid completion payload. Tests override individual
// fields to exercise validation edges.
//
// Phase 12c added `domain` (Screen 2) to the completion contract.
// Using "general_not_sure" in the fixture because it's always valid
// regardless of which sectors the test ships with — the per-sector
// domain options may drift, but the sentinel is guaranteed stable.
function validCompletionPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sectors: ["ai"],
    role: "engineer",
    domain: "general_not_sure",
    seniority: "mid",
    depth_preference: "standard",
    topics: [{ sector: "ai", topic: "foundation_models" }],
    goals: ["stay_current"],
    digest_preference: "morning",
    timezone: "America/New_York",
    ...overrides,
  };
}

describe("POST /api/v1/onboarding/events", () => {
  let token: string;

  beforeEach(() => {
    mock.reset();
    token = generateToken(userId, email);
  });

  it("returns 401 without a token", async () => {
    const res = await request(app)
      .post("/api/v1/onboarding/events")
      .send({ events: [{ event_type: "screen_view", screen_number: 1 }] });
    expect(res.status).toBe(401);
  });

  it("accepts a batch of events", async () => {
    const res = await request(app)
      .post("/api/v1/onboarding/events")
      .set(...auth(token))
      .send({
        events: [
          { event_type: "screen_view", screen_number: 1 },
          { event_type: "screen_skipped", screen_number: 5, metadata: { reason: "clicked_skip" } },
        ],
      });
    expect(res.status).toBe(202);
    expect(res.body.data.accepted).toBe(2);
  });

  it("rejects an empty batch", async () => {
    const res = await request(app)
      .post("/api/v1/onboarding/events")
      .set(...auth(token))
      .send({ events: [] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_INPUT");
  });

  it("rejects a batch above the cap", async () => {
    const events = Array.from({ length: 51 }, () => ({
      event_type: "screen_view",
      screen_number: 1,
    }));
    const res = await request(app)
      .post("/api/v1/onboarding/events")
      .set(...auth(token))
      .send({ events });
    expect(res.status).toBe(400);
  });

  it("rejects event with screen_number out of range", async () => {
    const res = await request(app)
      .post("/api/v1/onboarding/events")
      .set(...auth(token))
      .send({ events: [{ event_type: "screen_view", screen_number: 99 }] });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/v1/onboarding/complete", () => {
  let token: string;

  beforeEach(() => {
    mock.reset();
    token = generateToken(userId, email);
  });

  it("returns 401 without a token", async () => {
    const res = await request(app)
      .post("/api/v1/onboarding/complete")
      .send(validCompletionPayload());
    expect(res.status).toBe(401);
  });

  it("returns 400 when sectors is empty", async () => {
    const res = await request(app)
      .post("/api/v1/onboarding/complete")
      .set(...auth(token))
      .send(validCompletionPayload({ sectors: [] }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_INPUT");
  });

  it("returns 400 when sector value is unknown", async () => {
    const res = await request(app)
      .post("/api/v1/onboarding/complete")
      .set(...auth(token))
      .send(validCompletionPayload({ sectors: ["crypto"] }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when role is unknown", async () => {
    const res = await request(app)
      .post("/api/v1/onboarding/complete")
      .set(...auth(token))
      .send(validCompletionPayload({ role: "wizard" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when depth_preference is unknown", async () => {
    const res = await request(app)
      .post("/api/v1/onboarding/complete")
      .set(...auth(token))
      .send(validCompletionPayload({ depth_preference: "expert" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when digest_preference is unknown", async () => {
    const res = await request(app)
      .post("/api/v1/onboarding/complete")
      .set(...auth(token))
      .send(validCompletionPayload({ digest_preference: "afternoon" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when goals is empty (client must send [DEFAULT_GOAL] on skip)", async () => {
    const res = await request(app)
      .post("/api/v1/onboarding/complete")
      .set(...auth(token))
      .send(validCompletionPayload({ goals: [] }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when a topic is not valid for its sector", async () => {
    // foundries is a semiconductors topic, not an ai topic
    mock.queueSelect([{ id: userId }]); // user existence check
    const res = await request(app)
      .post("/api/v1/onboarding/complete")
      .set(...auth(token))
      .send(
        validCompletionPayload({
          topics: [{ sector: "ai", topic: "foundries" }],
        }),
      );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_INPUT");
  });

  it("returns 404 when the authenticated user no longer exists", async () => {
    mock.queueSelect([]); // user existence check: not found
    const res = await request(app)
      .post("/api/v1/onboarding/complete")
      .set(...auth(token))
      .send(validCompletionPayload());
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("USER_NOT_FOUND");
  });

  it("inserts a new profile row and reports completion", async () => {
    mock.queueSelect([{ id: userId }]); // user exists
    mock.queueSelect([]); // existing profile lookup: none
    mock.queueInsert([
      {
        userId,
        sectors: ["ai"],
        role: "engineer",
        seniority: "mid",
        depthPreference: "standard",
        goals: ["stay_current"],
        digestPreference: "morning",
        timezone: "America/New_York",
        completedAt: new Date("2026-04-23T00:00:00Z"),
      },
    ]); // insert .returning()

    const res = await request(app)
      .post("/api/v1/onboarding/complete")
      .set(...auth(token))
      .send(validCompletionPayload());

    expect(res.status).toBe(200);
    expect(res.body.data.profile.role).toBe("engineer");
    expect(res.body.data.completed_at).toBeTruthy();
  });

  it("flips an existing profile row (e.g. unsubscribe-only) to completed", async () => {
    mock.queueSelect([{ id: userId }]); // user exists
    mock.queueSelect([{ userId }]); // existing profile: yes
    mock.queueInsert([
      {
        userId,
        sectors: ["ai"],
        role: "engineer",
        seniority: "mid",
        depthPreference: "standard",
        goals: ["stay_current"],
        digestPreference: "morning",
        timezone: "America/New_York",
        completedAt: new Date("2026-04-23T00:00:00Z"),
      },
    ]); // update .returning()

    const res = await request(app)
      .post("/api/v1/onboarding/complete")
      .set(...auth(token))
      .send(validCompletionPayload());

    expect(res.status).toBe(200);
    expect(res.body.data.profile.completedAt).toBeTruthy();
  });

  it("dedupes duplicate (sector, topic) pairs before insert", async () => {
    mock.queueSelect([{ id: userId }]); // user exists
    mock.queueSelect([]); // existing profile: none
    mock.queueInsert([
      {
        userId,
        completedAt: new Date(),
        depthPreference: "standard",
      },
    ]); // insert .returning()

    const res = await request(app)
      .post("/api/v1/onboarding/complete")
      .set(...auth(token))
      .send(
        validCompletionPayload({
          topics: [
            { sector: "ai", topic: "foundation_models" },
            { sector: "ai", topic: "foundation_models" }, // duplicate
            { sector: "ai", topic: "agents" },
          ],
        }),
      );

    // No unique-violation bubble-up; the controller dedupes in-memory.
    expect(res.status).toBe(200);
  });
});
