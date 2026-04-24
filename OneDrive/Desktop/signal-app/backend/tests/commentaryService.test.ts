// Phase 12c — service-level orchestration tests.
//
// commentaryEndpoint.test.ts mocks the service boundary; the prompt/
// fallback/haiku-client modules have unit tests of their own. What's
// left untested is getOrGenerateCommentary's own logic: the cache hit
// branch, the cache-miss-then-Haiku-success persistence path, and the
// cache-miss-then-Haiku-failure tier3 path with its anomaly log.
//
// The mockDb helper ignores WHERE predicates and just drains queued
// result lists in call order — so the implicit contract here is the
// call sequence the service executes. Each test queues rows in the
// order the service reads them.

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

import { getOrGenerateCommentary } from "../src/services/commentaryService";

describe("commentaryService — getOrGenerateCommentary", () => {
  const baseInput = {
    userId: "user-1",
    storyId: "story-1",
    depth: "standard" as const,
    profileVersion: 3,
  };

  beforeEach(() => {
    mock.reset();
  });

  it("returns source=cache when a cache row exists, without calling Haiku", async () => {
    // 1. Cache lookup returns a row.
    mock.queueSelect([
      {
        id: "cache-1",
        userId: baseInput.userId,
        storyId: baseInput.storyId,
        depth: baseInput.depth,
        profileVersion: baseInput.profileVersion,
        commentary: "cached text",
      },
    ]);
    // 2. last_accessed_at update runs (mockDb treats it as delete-
    //    style, just returns rowCount:1 — no queue entry needed).

    const create = jest.fn();
    const result = await getOrGenerateCommentary(baseInput, {
      db: mock.db,
      haiku: { client: { create } },
    });

    expect(result).toEqual({
      commentary: "cached text",
      depth: "standard",
      profileVersion: 3,
      source: "cache",
    });
    // Cache-hit path must not wake the model.
    expect(create).not.toHaveBeenCalled();
  });

  it("calls Haiku on cache miss and persists + returns source=haiku", async () => {
    // 1. Cache lookup — miss.
    mock.queueSelect([]);
    // 2. Story lookup.
    mock.queueSelect([
      {
        id: baseInput.storyId,
        sector: "ai",
        headline: "A headline",
        context: "context",
        whyItMatters: "base reason",
      },
    ]);
    // 3. Profile lookup.
    mock.queueSelect([
      {
        role: "engineer",
        domain: "ml_engineering",
        seniority: "senior",
        sectors: ["ai"],
        goals: ["stay_current"],
      },
    ]);
    // 4. Topic interests.
    mock.queueSelect([{ sector: "ai", topic: "agents" }]);
    // 5. Insert .returning() — Haiku success persists.
    mock.queueInsert([
      {
        id: "cache-new",
        userId: baseInput.userId,
        storyId: baseInput.storyId,
        depth: baseInput.depth,
        profileVersion: baseInput.profileVersion,
        commentary: "fresh Haiku commentary for the engineer",
      },
    ]);

    const create = jest.fn().mockResolvedValue({
      content: [
        { type: "text", text: "fresh Haiku commentary for the engineer" },
      ],
    });

    const result = await getOrGenerateCommentary(baseInput, {
      db: mock.db,
      haiku: { client: { create } },
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(result.source).toBe("haiku");
    expect(result.commentary).toBe("fresh Haiku commentary for the engineer");
    expect(result.profileVersion).toBe(3);
  });

  it("routes to tier3 fallback and emits a warn when Haiku times out", async () => {
    // 1. Cache miss.
    mock.queueSelect([]);
    // 2. Story.
    mock.queueSelect([
      {
        id: baseInput.storyId,
        sector: "ai",
        headline: "Headline",
        context: "context",
        whyItMatters: "base reason",
      },
    ]);
    // 3. Profile.
    mock.queueSelect([
      {
        role: "engineer",
        domain: "ml_engineering",
        seniority: "senior",
        sectors: ["ai"],
        goals: ["stay_current"],
      },
    ]);
    // 4. Topics.
    mock.queueSelect([]);
    // No insert queued — tier3 path must not persist.

    // Simulate the SDK aborting on timeout. The client raises an
    // AbortError-shaped exception; the Haiku client normalizes this to
    // `{ ok: false, reason: "timeout" }` and the service routes that
    // through the tier3 mapper (`haiku_timeout`).
    const abortErr = Object.assign(new Error("aborted"), { name: "AbortError" });
    const create = jest.fn().mockRejectedValue(abortErr);

    const warn = jest.fn();
    const result = await getOrGenerateCommentary(baseInput, {
      db: mock.db,
      haiku: { client: { create } },
      logger: { info: jest.fn(), warn, error: jest.fn() },
    });

    expect(create).toHaveBeenCalledTimes(1);
    // Tier3 is the tier the fallback module produces for a haiku-side
    // failure (prompt wasn't the problem — the model was).
    expect(result.source).toBe("fallback_tier3");
    // Anomaly log ran exactly once with the userId/storyId context
    // plus the reason key stamped into the event payload.
    expect(warn).toHaveBeenCalledTimes(1);
    const [payload] = warn.mock.calls[0];
    expect(payload).toMatchObject({
      userId: baseInput.userId,
      storyId: baseInput.storyId,
      depth: baseInput.depth,
      profileVersion: baseInput.profileVersion,
    });
  });

  it("throws STORY_NOT_FOUND-shaped error when the story is missing", async () => {
    // 1. Cache miss.
    mock.queueSelect([]);
    // 2. Story lookup — empty. Service throws so the controller can
    //    map to a 404 before touching Haiku or the profile.
    mock.queueSelect([]);

    const create = jest.fn();
    await expect(
      getOrGenerateCommentary(baseInput, {
        db: mock.db,
        haiku: { client: { create } },
      }),
    ).rejects.toThrow(/story not found/);
    expect(create).not.toHaveBeenCalled();
  });
});
