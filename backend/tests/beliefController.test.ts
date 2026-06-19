/* eslint-disable @typescript-eslint/no-explicit-any */
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

// The belief path doesn't use Redis, but createApp's rate-limit middleware
// reaches for it — null = unconfigured = fail-open.
jest.mock("../src/lib/redis", () => ({
  __esModule: true,
  getRedis: () => null,
  isRedisConfigured: () => false,
}));

// Anthropic SDK mock — the matcher client is lazy, so a key is set below and
// `createMock` is the seam.
const createMock = jest.fn();
jest.mock("@anthropic-ai/sdk", () => {
  class Anthropic {
    public messages = {
      create: (...args: unknown[]): unknown => createMock(...args),
    };
  }
  return { __esModule: true, default: Anthropic };
});

import { createApp } from "../src/app";
import { generateToken } from "../src/services/authService";
import { __resetBeliefMatchClientForTests } from "../src/services/beliefMatchClient";
import { isoWeekKey } from "../src/services/beliefMatchService";

const app = createApp();

function auth(token: string): [string, string] {
  return ["Authorization", `Bearer ${token}`];
}

const userId = "user-1";
const beliefId = "11111111-1111-1111-1111-111111111111";
const challengeId = "22222222-2222-2222-2222-222222222222";
const eventId = "33333333-3333-3333-3333-333333333333";

function haikuText(text: string): any {
  return { content: [{ type: "text", text }] };
}

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
});

describe("beliefs API", () => {
  let token: string;
  beforeEach(() => {
    mock.reset();
    createMock.mockReset();
    __resetBeliefMatchClientForTests();
    token = generateToken(userId, "user@example.com");
  });

  it("creates a belief", async () => {
    mock.queueInsert([
      {
        id: beliefId,
        userId,
        statement: "Transformer scaling keeps winning",
        sector: "ai",
        status: "active",
      },
    ]);
    const res = await request(app)
      .post("/api/v1/beliefs")
      .set(...auth(token))
      .send({ statement: "Transformer scaling keeps winning", sector: "ai" });
    expect(res.status).toBe(201);
    expect(res.body.data.belief.statement).toContain("Transformer scaling");
    expect(mock.state.insertedValues[0]).toMatchObject({ userId, sector: "ai" });
  });

  it("creates a position with conviction, horizon, and a falsifier", async () => {
    mock.queueInsert([
      {
        id: beliefId,
        userId,
        statement: "TSMC N2 ramp stays on schedule",
        sector: "semiconductors",
        status: "active",
      },
    ]);
    const res = await request(app)
      .post("/api/v1/beliefs")
      .set(...auth(token))
      .send({
        statement: "TSMC N2 ramp stays on schedule",
        sector: "semiconductors",
        conviction: 4,
        horizon: "Q4 2026",
        whatWouldBreakIt: "A public slip of the N2 ramp date",
      });
    expect(res.status).toBe(201);
    expect(mock.state.insertedValues[0]).toMatchObject({
      userId,
      conviction: 4,
      horizon: "Q4 2026",
      whatWouldBreakIt: "A public slip of the N2 ramp date",
    });
  });

  it("rejects an out-of-range conviction", async () => {
    const res = await request(app)
      .post("/api/v1/beliefs")
      .set(...auth(token))
      .send({ statement: "A perfectly valid statement", conviction: 9 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_BODY");
  });

  it("rejects a too-short belief", async () => {
    const res = await request(app)
      .post("/api/v1/beliefs")
      .set(...auth(token))
      .send({ statement: "no" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_BODY");
  });

  it("lists beliefs", async () => {
    mock.queueSelect([
      { id: beliefId, statement: "X belief here", status: "active" },
      { id: "b2", statement: "Y belief here", status: "revised" },
    ]);
    const res = await request(app).get("/api/v1/beliefs").set(...auth(token));
    expect(res.status).toBe(200);
    expect(res.body.data.beliefs).toHaveLength(2);
  });

  it("runChallenges with no beliefs → empty, no Haiku call", async () => {
    mock.queueSelect([]); // active beliefs
    const res = await request(app)
      .post("/api/v1/beliefs/challenges/run")
      .set(...auth(token));
    expect(res.status).toBe(200);
    expect(res.body.data.beliefs_checked).toBe(0);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("runChallenges flags a contradicting development", async () => {
    mock.queueSelect([
      {
        id: beliefId,
        userId,
        statement: "Transformer scaling keeps winning",
        sector: "ai",
        status: "active",
      },
    ]); // active beliefs
    mock.queueSelect([]); // existing challenges (none this week)
    mock.queueSelect([{ sectors: ["ai"] }]); // profile sectors
    mock.queueSelect([
      {
        id: eventId,
        headline: "Sub-quadratic model beats GPT-4 at a tenth the compute",
        genericCommentary: "A state-space architecture matches frontier quality.",
        whyItMatters: "Cheaper frontier quality.",
      },
    ]); // candidate events
    createMock.mockResolvedValueOnce(
      haikuText(
        '{"relevance":"contradicts","event_index":1,"read":"Treat sub-quadratic architectures as a live threat to the scaling thesis.","dissent":"One benchmark is not a paradigm."}',
      ),
    );
    mock.queueSelect([
      {
        id: challengeId,
        belief_id: beliefId,
        statement: "Transformer scaling keeps winning",
        relevance: "contradicts",
        how_to_update:
          "Treat sub-quadratic architectures as a live threat to the scaling thesis.",
        dissent: "One benchmark is not a paradigm.",
        source_headline: "Sub-quadratic model beats GPT-4 at a tenth the compute",
        event_id: eventId,
        response: null,
      },
    ]); // loadWeekChallenges

    const res = await request(app)
      .post("/api/v1/beliefs/challenges/run")
      .set(...auth(token));

    expect(res.status).toBe(200);
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(res.body.data.challenges).toHaveLength(1);
    expect(res.body.data.challenges[0].relevance).toBe("contradicts");
    expect(res.body.data.challenges[0].how_to_update).toContain("sub-quadratic");
    const inserted = mock.state.insertedValues.find((v) => v.howToUpdate);
    expect(inserted).toMatchObject({
      beliefId,
      userId,
      eventId,
      relevance: "contradicts",
    });
    // Cost guard: a processed belief is marked checked for the week.
    expect(mock.state.updatedRows.some((r) => r.lastCheckedWeekKey)).toBe(true);
  });

  it("runChallenges skips a belief already checked this week (cost guard)", async () => {
    const week = isoWeekKey(new Date());
    mock.queueSelect([
      {
        id: beliefId,
        userId,
        statement: "Transformer scaling keeps winning",
        sector: "ai",
        status: "active",
        lastCheckedWeekKey: week,
      },
    ]); // active beliefs — already checked this week
    mock.queueSelect([]); // existing challenges (none)
    mock.queueSelect([]); // loadWeekChallenges
    const res = await request(app)
      .post("/api/v1/beliefs/challenges/run")
      .set(...auth(token));
    expect(res.status).toBe(200);
    expect(res.body.data.beliefs_checked).toBe(0);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("runChallenges force re-check bypasses the weekly cost guard", async () => {
    const week = isoWeekKey(new Date());
    mock.queueSelect([
      {
        id: beliefId,
        userId,
        statement: "Transformer scaling keeps winning",
        sector: "ai",
        status: "active",
        lastCheckedWeekKey: week, // already checked — skipped WITHOUT force
      },
    ]); // active beliefs
    mock.queueSelect([]); // existing challenges (unresponded ones just cleared)
    mock.queueSelect([{ sectors: ["ai"] }]); // profile sectors
    mock.queueSelect([
      {
        id: eventId,
        headline: "Sub-quadratic model beats GPT-4 at a tenth the compute",
        genericCommentary: "A state-space architecture matches frontier quality.",
        whyItMatters: "Cheaper frontier quality.",
      },
    ]); // candidate events
    createMock.mockResolvedValueOnce(
      haikuText(
        '{"relevance":"pressures","event_index":1,"read":"Efficiency gains pressure the pure-scaling thesis.","dissent":"One result is not a trend."}',
      ),
    );
    mock.queueSelect([
      {
        id: challengeId,
        belief_id: beliefId,
        statement: "Transformer scaling keeps winning",
        relevance: "pressures",
        how_to_update: "Efficiency gains pressure the pure-scaling thesis.",
        dissent: "One result is not a trend.",
        source_headline: "Sub-quadratic model beats GPT-4 at a tenth the compute",
        event_id: eventId,
        response: null,
      },
    ]); // loadWeekChallenges

    const res = await request(app)
      .post("/api/v1/beliefs/challenges/run")
      .set(...auth(token))
      .send({ force: true });

    expect(res.status).toBe(200);
    // Marker bypassed: the already-checked belief was matched anyway.
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(res.body.data.beliefs_checked).toBe(1);
    expect(res.body.data.challenges[0].relevance).toBe("pressures");
    // The unresponded-challenge clear ran.
    expect(mock.state.deletes.length).toBe(1);
  });

  it("respond 'revised' marks the belief and logs the north-star event", async () => {
    mock.queueInsert([{ id: challengeId, beliefId, userId, weekKey: "2026-W25" }]); // challenge update().returning()
    const res = await request(app)
      .post(`/api/v1/beliefs/challenges/${challengeId}/respond`)
      .set(...auth(token))
      .send({ response: "revised" });
    expect(res.status).toBe(200);
    expect(mock.state.updatedRows.some((r) => r.status === "revised")).toBe(true);
    expect(
      mock.state.insertedValues.some((v) => v.eventType === "belief_revised"),
    ).toBe(true);
  });

  it("respond 'dismissed' does not log the north-star event", async () => {
    mock.queueInsert([{ id: challengeId, beliefId, userId }]);
    const res = await request(app)
      .post(`/api/v1/beliefs/challenges/${challengeId}/respond`)
      .set(...auth(token))
      .send({ response: "dismissed" });
    expect(res.status).toBe(200);
    expect(
      mock.state.insertedValues.some((v) => v.eventType === "belief_revised"),
    ).toBe(false);
  });

  it("respond 'strengthened' logs belief_strengthened with a note, not a revision", async () => {
    mock.queueInsert([{ id: challengeId, beliefId, userId }]); // challenge update().returning()
    const res = await request(app)
      .post(`/api/v1/beliefs/challenges/${challengeId}/respond`)
      .set(...auth(token))
      .send({ response: "strengthened", note: "the efficiency gains are real" });
    expect(res.status).toBe(200);
    // The reader's note is stored on the challenge.
    expect(
      mock.state.updatedRows.some(
        (r) => r.responseNote === "the efficiency gains are real",
      ),
    ).toBe(true);
    // Growth half of the north star fires; no revision.
    expect(
      mock.state.insertedValues.some((v) => v.eventType === "belief_strengthened"),
    ).toBe(true);
    expect(
      mock.state.insertedValues.some((v) => v.eventType === "belief_revised"),
    ).toBe(false);
    expect(mock.state.updatedRows.some((r) => r.status === "revised")).toBe(false);
  });

  it("returns a belief's evolution timeline", async () => {
    mock.queueSelect([
      {
        id: beliefId,
        statement: "Transformer scaling keeps winning",
        sector: "ai",
        status: "active",
      },
    ]); // belief ownership lookup
    mock.queueSelect([
      {
        id: challengeId,
        belief_id: beliefId,
        relevance: "supports",
        how_to_update: "Efficiency results reinforce the scaling thesis.",
        response: "strengthened",
        response_note: "the efficiency gains are real",
        source_headline: "A new result strengthens scaling",
      },
    ]); // loadBeliefEvolution
    const res = await request(app)
      .get(`/api/v1/beliefs/${beliefId}/evolution`)
      .set(...auth(token));
    expect(res.status).toBe(200);
    expect(res.body.data.belief.id).toBe(beliefId);
    expect(res.body.data.evolution).toHaveLength(1);
    expect(res.body.data.evolution[0].response_note).toContain("efficiency gains");
  });

  it("requires authentication", async () => {
    const res = await request(app)
      .post("/api/v1/beliefs")
      .send({ statement: "an unauthenticated belief attempt" });
    expect(res.status).toBe(401);
  });
});
