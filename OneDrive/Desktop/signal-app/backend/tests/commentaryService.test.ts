// Phase 12c — service-level orchestration tests.
// Phase 12d — updated for {thesis, support} JSON shape, the four-stage
// JSON enforcement, and the parse-failure retry.
//
// commentaryEndpoint.test.ts mocks the service boundary; the prompt /
// fallback / haiku-client / parser / word-count modules have unit
// tests of their own. What's left untested is getOrGenerateCommentary's
// own logic: the cache hit branch, the cache-miss-then-Haiku-success
// persistence path, the parse-failure-then-retry path, banned-opener
// rejection, and the cache-miss-then-Haiku-failure tier3 path with its
// anomaly log.
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
import { COMMENTARY_PREFILL } from "../src/services/commentaryPromptV2";

const goodCommentary = {
  thesis:
    "The release shifts the capability frontier and changes how product teams should pace their roadmap against frontier model availability.",
  support:
    "The new chain-of-thought mode plus a doubled context window changes which workloads can run cheaply against a hosted model rather than fine-tuned in-house. Teams running retrieval-heavy stacks should re-examine the cost curve over the next quarter — what was previously infrastructure work may now be a hosted-API call.",
};

function haikuJsonText(value: { thesis: string; support: string }): string {
  // The Anthropic SDK returns only the model's continuation — the bytes
  // after the assistant prefill. The haiku client re-attaches the prefill
  // (COMMENTARY_PREFILL = "{") before the parser sees the assembled text.
  // Strip the leading prefill bytes here so the post-prepend payload is a
  // single well-formed JSON object rather than e.g. "{{...".
  return JSON.stringify(value).slice(COMMENTARY_PREFILL.length);
}

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
    mock.queueSelect([
      {
        id: "cache-1",
        userId: baseInput.userId,
        storyId: baseInput.storyId,
        depth: baseInput.depth,
        profileVersion: baseInput.profileVersion,
        commentary: goodCommentary,
      },
    ]);

    const create = jest.fn();
    const result = await getOrGenerateCommentary(baseInput, {
      db: mock.db,
      haiku: { client: { create } },
    });

    expect(result).toEqual({
      commentary: goodCommentary,
      depth: "standard",
      profileVersion: 3,
      source: "cache",
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("calls Haiku on cache miss and persists + returns source=haiku", async () => {
    mock.queueSelect([]); // cache miss
    mock.queueSelect([
      {
        id: baseInput.storyId,
        sector: "ai",
        headline: "A headline",
        context: "context",
        whyItMatters: "base reason",
      },
    ]);
    mock.queueSelect([
      {
        role: "engineer",
        domain: "ml_engineering",
        seniority: "senior",
        sectors: ["ai"],
        goals: ["stay_current"],
      },
    ]);
    mock.queueSelect([{ sector: "ai", topic: "agents" }]);
    mock.queueInsert([
      {
        id: "cache-new",
        userId: baseInput.userId,
        storyId: baseInput.storyId,
        depth: baseInput.depth,
        profileVersion: baseInput.profileVersion,
        commentary: goodCommentary,
      },
    ]);

    const create = jest.fn().mockResolvedValue({
      content: [{ type: "text", text: haikuJsonText(goodCommentary) }],
    });

    const result = await getOrGenerateCommentary(baseInput, {
      db: mock.db,
      haiku: { client: { create } },
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(result.source).toBe("haiku");
    expect(result.commentary).toEqual(goodCommentary);
    expect(result.profileVersion).toBe(3);
  });

  it("retries once on parse failure and succeeds on the second call", async () => {
    mock.queueSelect([]); // cache miss
    mock.queueSelect([
      {
        id: baseInput.storyId,
        sector: "ai",
        headline: "A headline",
        context: "context",
        whyItMatters: "base reason",
      },
    ]);
    mock.queueSelect([
      {
        role: "engineer",
        domain: "ml_engineering",
        seniority: "senior",
        sectors: ["ai"],
        goals: ["stay_current"],
      },
    ]);
    mock.queueSelect([{ sector: "ai", topic: "agents" }]);
    mock.queueInsert([
      {
        id: "cache-new",
        userId: baseInput.userId,
        storyId: baseInput.storyId,
        depth: baseInput.depth,
        profileVersion: baseInput.profileVersion,
        commentary: goodCommentary,
      },
    ]);

    // First call returns prose; second call returns clean JSON.
    const create = jest
      .fn()
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "I'm sorry, here's the commentary in plain prose." }],
      })
      .mockResolvedValueOnce({
        content: [{ type: "text", text: haikuJsonText(goodCommentary) }],
      });

    const result = await getOrGenerateCommentary(baseInput, {
      db: mock.db,
      haiku: { client: { create } },
    });

    expect(create).toHaveBeenCalledTimes(2);
    expect(result.source).toBe("haiku");
    expect(result.commentary).toEqual(goodCommentary);
  });

  it("falls back to tier3 on parse failure that survives the retry", async () => {
    mock.queueSelect([]); // cache miss
    mock.queueSelect([
      {
        id: baseInput.storyId,
        sector: "ai",
        headline: "A headline",
        context: "context",
        whyItMatters: "base reason",
      },
    ]);
    mock.queueSelect([
      {
        role: "engineer",
        domain: "ml_engineering",
        seniority: "senior",
        sectors: ["ai"],
        goals: ["stay_current"],
      },
    ]);
    mock.queueSelect([{ sector: "ai", topic: "agents" }]);
    // No insert queued — tier3 path must not persist.

    const create = jest.fn().mockResolvedValue({
      content: [{ type: "text", text: "still not json on the retry either" }],
    });

    const warn = jest.fn();
    const result = await getOrGenerateCommentary(baseInput, {
      db: mock.db,
      haiku: { client: { create } },
      logger: { info: jest.fn(), warn, error: jest.fn() },
    });

    expect(create).toHaveBeenCalledTimes(2);
    expect(result.source).toBe("fallback_tier3");
    expect(warn).toHaveBeenCalledTimes(1);
    const [payload] = warn.mock.calls[0];
    expect(payload).toMatchObject({
      reason: "haiku_json_parse",
      retried: true,
    });
  });

  it("falls back to tier3 with reason=haiku_banned_opener when thesis opens with 'As you …'", async () => {
    mock.queueSelect([]); // cache miss
    mock.queueSelect([
      {
        id: baseInput.storyId,
        sector: "ai",
        headline: "A headline",
        context: "context",
        whyItMatters: "base reason",
      },
    ]);
    mock.queueSelect([
      {
        role: "engineer",
        domain: "ml_engineering",
        seniority: "senior",
        sectors: ["ai"],
        goals: ["stay_current"],
      },
    ]);
    mock.queueSelect([{ sector: "ai", topic: "agents" }]);

    const tripsOpener = {
      thesis: "As you track foundation models, this release shifts the capability frontier in your space.",
      support: "Two new modes plus a wider context window change which workloads stay cheap against the hosted API.",
    };
    const create = jest.fn().mockResolvedValue({
      content: [{ type: "text", text: haikuJsonText(tripsOpener) }],
    });

    const warn = jest.fn();
    const result = await getOrGenerateCommentary(baseInput, {
      db: mock.db,
      haiku: { client: { create } },
      logger: { info: jest.fn(), warn, error: jest.fn() },
    });

    expect(result.source).toBe("fallback_tier3");
    expect(warn).toHaveBeenCalledTimes(1);
    const [payload] = warn.mock.calls[0];
    expect(payload).toMatchObject({
      reason: "haiku_banned_opener",
    });
    expect(payload.haikuOpenerOffenders).toBeDefined();
  });

  it("logs a word-budget drift warning but still persists when over budget", async () => {
    mock.queueSelect([]); // cache miss
    mock.queueSelect([
      {
        id: baseInput.storyId,
        sector: "ai",
        headline: "A headline",
        context: "context",
        whyItMatters: "base reason",
      },
    ]);
    mock.queueSelect([
      {
        role: "engineer",
        domain: "ml_engineering",
        seniority: "senior",
        sectors: ["ai"],
        goals: ["stay_current"],
      },
    ]);
    mock.queueSelect([{ sector: "ai", topic: "agents" }]);

    // 100-word thesis vs 40-word standard budget = 150% over → flagged.
    // Support is in-budget at 90.
    const overBudget = {
      thesis: Array.from({ length: 100 }, (_, i) => `t${i}`).join(" "),
      support: Array.from({ length: 90 }, (_, i) => `s${i}`).join(" "),
    };
    mock.queueInsert([
      {
        id: "cache-new",
        userId: baseInput.userId,
        storyId: baseInput.storyId,
        depth: baseInput.depth,
        profileVersion: baseInput.profileVersion,
        commentary: overBudget,
      },
    ]);

    const create = jest.fn().mockResolvedValue({
      content: [{ type: "text", text: haikuJsonText(overBudget) }],
    });

    const warn = jest.fn();
    const result = await getOrGenerateCommentary(baseInput, {
      db: mock.db,
      haiku: { client: { create } },
      logger: { info: jest.fn(), warn, error: jest.fn() },
    });

    expect(result.source).toBe("haiku");
    // Drift warning emitted exactly once for the thesis.
    expect(warn).toHaveBeenCalledTimes(1);
    const [payload] = warn.mock.calls[0];
    expect(payload).toMatchObject({
      event: "commentary_word_budget_drift",
      field: "thesis",
      direction: "over",
    });
  });

  it("routes to tier3 fallback and emits a warn when Haiku times out", async () => {
    mock.queueSelect([]); // cache miss
    mock.queueSelect([
      {
        id: baseInput.storyId,
        sector: "ai",
        headline: "Headline",
        context: "context",
        whyItMatters: "base reason",
      },
    ]);
    mock.queueSelect([
      {
        role: "engineer",
        domain: "ml_engineering",
        seniority: "senior",
        sectors: ["ai"],
        goals: ["stay_current"],
      },
    ]);
    mock.queueSelect([]);

    // SDK aborts → AbortError → reason="timeout" → tier3.
    const abortErr = Object.assign(new Error("aborted"), { name: "AbortError" });
    const create = jest.fn().mockRejectedValue(abortErr);

    const warn = jest.fn();
    const result = await getOrGenerateCommentary(baseInput, {
      db: mock.db,
      haiku: { client: { create } },
      logger: { info: jest.fn(), warn, error: jest.fn() },
    });

    expect(create).toHaveBeenCalledTimes(1); // transport failure → no retry
    expect(result.source).toBe("fallback_tier3");
    expect(warn).toHaveBeenCalledTimes(1);
    const [payload] = warn.mock.calls[0];
    expect(payload).toMatchObject({
      reason: "haiku_timeout",
      userId: baseInput.userId,
      storyId: baseInput.storyId,
      depth: baseInput.depth,
      profileVersion: baseInput.profileVersion,
    });
  });

  it("throws STORY_NOT_FOUND-shaped error when the story is missing", async () => {
    mock.queueSelect([]); // cache miss
    mock.queueSelect([]); // story missing

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
