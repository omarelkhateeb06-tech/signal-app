/* eslint-disable @typescript-eslint/no-explicit-any */
import { createMockDb } from "./helpers/mockDb";

const mock = createMockDb();

jest.mock("../src/db", () => ({
  __esModule: true,
  get db() {
    return mock.db;
  },
  pool: { end: async (): Promise<void> => undefined },
}));

// Stub the Anthropic SDK so no network calls happen — the test module
// imports from `../src/services/depthVariantGenerator`, which constructs
// the client lazily.
jest.mock("@anthropic-ai/sdk", () => {
  class Anthropic {
    public messages = {
      create: jest.fn(),
    };
  }
  return { __esModule: true, default: Anthropic };
});

import {
  regenerateAll,
  listStoriesForRegeneration,
  parseArgs,
} from "../src/scripts/regenerateDepthVariants";
import type { StoryForDepthGen } from "../src/services/depthVariantGenerator";

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports
const { db } = require("../src/db") as { db: any };

function makeStory(overrides: Partial<StoryForDepthGen> = {}): StoryForDepthGen {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    headline: "OpenAI closes record round",
    sector: "ai",
    context: "OpenAI closed its largest-ever funding round on March 31.",
    whyItMatters: "Role-neutral fallback commentary.",
    ...overrides,
  };
}

describe("regenerateDepthVariants", () => {
  beforeEach(() => {
    mock.reset();
  });

  describe("parseArgs", () => {
    it("defaults to non-dry, non-yes", () => {
      expect(parseArgs([])).toEqual({ dryRun: false, yes: false });
    });

    it("parses --dry-run / --yes / --id=<uuid>", () => {
      expect(parseArgs(["--dry-run", "--yes", "--id=abc"])).toEqual({
        dryRun: true,
        yes: true,
        id: "abc",
      });
    });

    it("parses the space-separated --id form", () => {
      expect(parseArgs(["--id", "xyz"])).toEqual({ dryRun: false, yes: false, id: "xyz" });
    });
  });

  describe("listStoriesForRegeneration", () => {
    it("reads all stories when no id is passed", async () => {
      mock.queueSelect([makeStory(), makeStory({ id: "2", headline: "b" })]);
      const rows = await listStoriesForRegeneration(db);
      expect(rows).toHaveLength(2);
    });

    it("reads a single story when an id is passed", async () => {
      mock.queueSelect([makeStory({ id: "single" })]);
      const rows = await listStoriesForRegeneration(db, "single");
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe("single");
    });
  });

  describe("regenerateAll", () => {
    it("calls the generator once per story and reports all succeeded", async () => {
      const generate = jest.fn().mockResolvedValue({
        accessible: "a",
        briefed: "b",
        technical: "t",
      });
      const stories = [makeStory(), makeStory({ id: "2" }), makeStory({ id: "3" })];
      const summary = await regenerateAll(stories, db, { generate });
      expect(generate).toHaveBeenCalledTimes(3);
      expect(summary).toEqual({ total: 3, succeeded: 3, failed: [] });
    });

    it("produces a payload containing exactly the three depth keys", async () => {
      let capturedTemplate: Record<string, string> | null = null;
      const generate = jest.fn(async () => {
        const template = { accessible: "a", briefed: "b", technical: "t" };
        capturedTemplate = template;
        return template;
      });
      await regenerateAll([makeStory()], db, { generate });
      expect(capturedTemplate).not.toBeNull();
      const template = capturedTemplate as unknown as Record<string, string>;
      expect(Object.keys(template).sort()).toEqual([
        "accessible",
        "briefed",
        "technical",
      ]);
    });

    it("records per-story failures without stopping the run", async () => {
      const generate = jest
        .fn()
        .mockResolvedValueOnce({ accessible: "a", briefed: "b", technical: "t" })
        .mockRejectedValueOnce(new Error("rate limit"))
        .mockResolvedValueOnce({ accessible: "a", briefed: "b", technical: "t" });
      const stories = [makeStory(), makeStory({ id: "2" }), makeStory({ id: "3" })];
      const summary = await regenerateAll(stories, db, { generate });
      expect(summary.total).toBe(3);
      expect(summary.succeeded).toBe(2);
      expect(summary.failed).toEqual([{ id: "2", error: "rate limit" }]);
    });

    it("skips the UPDATE write in dry-run mode but still calls the generator", async () => {
      const generate = jest
        .fn()
        .mockResolvedValue({ accessible: "a", briefed: "b", technical: "t" });
      const updateSpy = jest.spyOn(db, "update");
      const summary = await regenerateAll([makeStory()], db, { generate, dryRun: true });
      expect(summary.succeeded).toBe(1);
      expect(generate).toHaveBeenCalledTimes(1);
      expect(updateSpy).not.toHaveBeenCalled();
      updateSpy.mockRestore();
    });
  });
});
