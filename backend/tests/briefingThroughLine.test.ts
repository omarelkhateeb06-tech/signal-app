/* eslint-disable @typescript-eslint/no-explicit-any */
import request from "supertest";
import type { Redis } from "ioredis";
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

// Redis mock at the lib boundary — same seam the paywall + rate limiter
// use. `redisInstance` toggles between a get/set mock and null so we can
// exercise the configured and Redis-down branches.
const getMock = jest.fn();
const setMock = jest.fn();

let redisInstance: Pick<Redis, "get" | "set"> | null = null;

jest.mock("../src/lib/redis", () => ({
  __esModule: true,
  getRedis: () => redisInstance,
  isRedisConfigured: () => redisInstance !== null,
}));

// Anthropic SDK mock — the Through-Line client constructs the client
// lazily, so a process.env.ANTHROPIC_API_KEY is set below to push it
// past the no_api_key short-circuit, and `createMock` is the seam we
// drive per-test.
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
import { __resetThroughLineClientForTests } from "../src/services/throughLineClient";

const app = createApp();

function auth(token: string): [string, string] {
  return ["Authorization", `Bearer ${token}`];
}

const userId = "user-1";
const idA = "11111111-1111-1111-1111-111111111111";
const idB = "22222222-2222-2222-2222-222222222222";

function setRedis(on: boolean): void {
  redisInstance = on
    ? {
        get: getMock as unknown as Redis["get"],
        set: setMock as unknown as Redis["set"],
      }
    : null;
}

function resetAll(): void {
  mock.reset();
  getMock.mockReset();
  setMock.mockReset();
  createMock.mockReset();
  __resetThroughLineClientForTests();
  setRedis(true);
}

const queueProfile = (): void => {
  mock.queueSelect([
    {
      role: "engineer",
      domain: "ml_infra",
      seniority: "senior",
      sectors: ["ai", "semiconductors"],
      goals: ["stay_current"],
      profileVersion: 3,
    },
  ]);
};
const queueEventRows = (rows: any[]): void => {
  mock.queueSelect(rows);
};

function eventRow(id: string, overrides: Record<string, unknown> = {}): any {
  return {
    id,
    headline: `Headline ${id.slice(0, 4)}`,
    whyItMatters: "This matters. Second sentence.",
    genericCommentary: null,
    ...overrides,
  };
}

function haikuTextResponse(text: string): any {
  return { content: [{ type: "text", text }] };
}

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
});

describe("GET /api/v1/briefing/through-line", () => {
  let token: string;
  beforeEach(() => {
    resetAll();
    token = generateToken(userId, "user@example.com");
  });

  // D3 — the Through-Line is the FREE daily hook. The endpoint no longer
  // branches on tier, so a free reader takes the same cache→generate path
  // as Pro and is never handed a gate envelope.
  it("(a) free reader is not gated — gets the Through-Line like everyone else", async () => {
    queueProfile();
    getMock.mockResolvedValueOnce(null); // cache miss
    queueEventRows([eventRow(idA), eventRow(idB)]);
    setMock.mockResolvedValueOnce("OK");
    createMock.mockResolvedValueOnce(
      haikuTextResponse(
        "Both moves point one way: compute is consolidating, and for your role that narrows vendor options as the roadmap widens.",
      ),
    );

    const res = await request(app)
      .get(`/api/v1/briefing/through-line?storyIds=${idA},${idB}`)
      .set(...auth(token));

    expect(res.status).toBe(200);
    expect(res.body.data.gated).toBeUndefined();
    expect(res.body.data.source).toBe("haiku");
    expect(res.body.data.through_line).toContain("compute is consolidating");
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("(b) pro tier + cache miss → Haiku called, returns synthesis, source haiku", async () => {
    queueProfile();
    getMock.mockResolvedValueOnce(null); // cache miss
    queueEventRows([eventRow(idA), eventRow(idB)]); // events lookup resolves both
    setMock.mockResolvedValueOnce("OK");
    createMock.mockResolvedValueOnce(
      haikuTextResponse(
        "Both moves point the same direction: compute is consolidating. For a senior ML engineer, that compresses your vendor options just as your roadmap expands.",
      ),
    );

    const res = await request(app)
      .get(`/api/v1/briefing/through-line?storyIds=${idA},${idB}`)
      .set(...auth(token));

    expect(res.status).toBe(200);
    expect(res.body.data.source).toBe("haiku");
    expect(res.body.data.through_line).toContain("compute is consolidating");
    expect(createMock).toHaveBeenCalledTimes(1);
    // The result was cached under the daily key.
    expect(setMock).toHaveBeenCalledTimes(1);
    const setArgs = setMock.mock.calls[0];
    expect(String(setArgs[0])).toContain("valo:through-line:");
    expect(String(setArgs[0])).toContain(":3:"); // profile_version in key
    expect(setArgs[2]).toBe("EX");
  });

  it("(b') pro tier + cache hit → returns cached, no Haiku call", async () => {
    queueProfile();
    getMock.mockResolvedValueOnce("Cached through-line.");

    const res = await request(app)
      .get(`/api/v1/briefing/through-line?storyIds=${idA}`)
      .set(...auth(token));

    expect(res.status).toBe(200);
    expect(res.body.data.source).toBe("haiku");
    expect(res.body.data.through_line).toBe("Cached through-line.");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("(c) pro tier + Haiku failure → through_line null, source unavailable", async () => {
    queueProfile();
    getMock.mockResolvedValueOnce(null);
    queueEventRows([eventRow(idA)]);
    createMock.mockRejectedValueOnce(new Error("503 upstream"));

    const res = await request(app)
      .get(`/api/v1/briefing/through-line?storyIds=${idA}`)
      .set(...auth(token));

    expect(res.status).toBe(200);
    expect(res.body.data.through_line).toBeNull();
    expect(res.body.data.source).toBe("unavailable");
    expect(setMock).not.toHaveBeenCalled();
  });

  it("(c') pro tier, none of the ids resolve → unavailable, no Haiku call", async () => {
    queueProfile();
    getMock.mockResolvedValueOnce(null);
    queueEventRows([]); // events lookup empty
    queueEventRows([]); // stories fallback empty

    const res = await request(app)
      .get(`/api/v1/briefing/through-line?storyIds=${idA}`)
      .set(...auth(token));

    expect(res.status).toBe(200);
    expect(res.body.data.through_line).toBeNull();
    expect(res.body.data.source).toBe("unavailable");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("(c'') pro tier + Redis unconfigured → unavailable, no Haiku call (cost fuse)", async () => {
    setRedis(false);

    const res = await request(app)
      .get(`/api/v1/briefing/through-line?storyIds=${idA}`)
      .set(...auth(token));

    expect(res.status).toBe(200);
    expect(res.body.data.through_line).toBeNull();
    expect(res.body.data.source).toBe("unavailable");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("(d) invalid storyIds → 400 INVALID_QUERY", async () => {

    const res = await request(app)
      .get(`/api/v1/briefing/through-line?storyIds=not-a-uuid`)
      .set(...auth(token));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_QUERY");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("(d') missing storyIds param → 400 INVALID_QUERY", async () => {

    const res = await request(app)
      .get(`/api/v1/briefing/through-line`)
      .set(...auth(token));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_QUERY");
  });

  it("requires authentication", async () => {
    const res = await request(app).get(
      `/api/v1/briefing/through-line?storyIds=${idA}`,
    );
    expect(res.status).toBe(401);
  });
});
