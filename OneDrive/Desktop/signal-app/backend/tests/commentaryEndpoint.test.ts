// Phase 12c — GET /api/v1/stories/:id/commentary integration test.
//
// This stubs getOrGenerateCommentary at the service module boundary
// (rather than wiring a full mock DB through every cache-hit / Haiku /
// fallback codepath) because the service itself is covered end-to-end
// by commentaryFallback / commentaryPrompt / matchedInterests unit
// suites. What we're guarding here is the controller contract:
//   - auth gate
//   - uuid validation
//   - depth override precedence (explicit query > stored preference)
//   - pre-onboarding 400
//   - story-not-found 404 mapping
//   - JSON envelope shape matches the client's expectation

import request from "supertest";
import { createMockDb } from "./helpers/mockDb";

const mock = createMockDb();

const getOrGenerateCommentaryMock = jest.fn();

jest.mock("../src/db", () => ({
  __esModule: true,
  get db() {
    return mock.db;
  },
  schema: {},
  pool: {},
}));

jest.mock("../src/services/commentaryService", () => ({
  __esModule: true,
  getOrGenerateCommentary: (...args: unknown[]) =>
    getOrGenerateCommentaryMock(...args),
}));

import { createApp } from "../src/app";
import { generateToken } from "../src/services/authService";

const app = createApp();

function auth(token: string): [string, string] {
  return ["Authorization", `Bearer ${token}`];
}

const userId = "user-1";
const email = "reader@example.com";
const storyId = "11111111-1111-1111-1111-111111111111";

describe("GET /api/v1/stories/:id/commentary", () => {
  let token: string;

  beforeEach(() => {
    mock.reset();
    getOrGenerateCommentaryMock.mockReset();
    token = generateToken(userId, email);
  });

  it("returns 401 without a token", async () => {
    const res = await request(app).get(`/api/v1/stories/${storyId}/commentary`);
    expect(res.status).toBe(401);
    expect(getOrGenerateCommentaryMock).not.toHaveBeenCalled();
  });

  it("returns 400 on a non-uuid id param", async () => {
    const res = await request(app)
      .get("/api/v1/stories/not-a-uuid/commentary")
      .set(...auth(token));
    expect(res.status).toBe(400);
    expect(getOrGenerateCommentaryMock).not.toHaveBeenCalled();
  });

  it("returns 400 when the user has no profile row (pre-onboarding direct link)", async () => {
    mock.queueSelect([]); // empty profile lookup

    const res = await request(app)
      .get(`/api/v1/stories/${storyId}/commentary`)
      .set(...auth(token));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("PROFILE_NOT_FOUND");
    expect(getOrGenerateCommentaryMock).not.toHaveBeenCalled();
  });

  it("happy path: passes stored depth_preference + profileVersion to the service and returns the JSON envelope", async () => {
    mock.queueSelect([
      { depthPreference: "technical", profileVersion: 4 },
    ]);
    getOrGenerateCommentaryMock.mockResolvedValueOnce({
      commentary: "A deep-insider take on the release.",
      depth: "technical",
      profileVersion: 4,
      source: "haiku",
    });

    const res = await request(app)
      .get(`/api/v1/stories/${storyId}/commentary`)
      .set(...auth(token));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      commentary: "A deep-insider take on the release.",
      depth: "technical",
      profile_version: 4,
      source: "haiku",
    });
    expect(getOrGenerateCommentaryMock).toHaveBeenCalledTimes(1);
    const [callInput] = getOrGenerateCommentaryMock.mock.calls[0];
    expect(callInput).toMatchObject({
      userId,
      storyId,
      depth: "technical",
      profileVersion: 4,
    });
  });

  it("explicit ?depth= query override beats the stored preference", async () => {
    // User's stored preference is "accessible" but they're asking for
    // "technical" (e.g. Premium depth selector on story detail).
    mock.queueSelect([
      { depthPreference: "accessible", profileVersion: 1 },
    ]);
    getOrGenerateCommentaryMock.mockResolvedValueOnce({
      commentary: "…",
      depth: "technical",
      profileVersion: 1,
      source: "cache",
    });

    const res = await request(app)
      .get(`/api/v1/stories/${storyId}/commentary?depth=technical`)
      .set(...auth(token));

    expect(res.status).toBe(200);
    expect(getOrGenerateCommentaryMock.mock.calls[0][0].depth).toBe("technical");
  });

  it("falls back to 'standard' when the user has no depth preference stored", async () => {
    mock.queueSelect([
      { depthPreference: null, profileVersion: 1 },
    ]);
    getOrGenerateCommentaryMock.mockResolvedValueOnce({
      commentary: "…",
      depth: "standard",
      profileVersion: 1,
      source: "fallback_tier2",
    });

    const res = await request(app)
      .get(`/api/v1/stories/${storyId}/commentary`)
      .set(...auth(token));

    expect(res.status).toBe(200);
    expect(getOrGenerateCommentaryMock.mock.calls[0][0].depth).toBe("standard");
    expect(res.body.data.source).toBe("fallback_tier2");
  });

  it("rejects an invalid depth query value at the validator, not the service", async () => {
    const res = await request(app)
      .get(`/api/v1/stories/${storyId}/commentary?depth=wizard`)
      .set(...auth(token));

    expect(res.status).toBe(400);
    expect(getOrGenerateCommentaryMock).not.toHaveBeenCalled();
  });

  it("maps 'story not found' from the service layer to a proper 404", async () => {
    mock.queueSelect([
      { depthPreference: "standard", profileVersion: 1 },
    ]);
    getOrGenerateCommentaryMock.mockRejectedValueOnce(
      new Error(`story not found: ${storyId}`),
    );

    const res = await request(app)
      .get(`/api/v1/stories/${storyId}/commentary`)
      .set(...auth(token));

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("STORY_NOT_FOUND");
  });
});
