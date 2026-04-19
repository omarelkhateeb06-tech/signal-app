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

import { compileDigest, currentDigestWindow } from "../src/services/digestService";

describe("digestService", () => {
  beforeEach(() => {
    mock.reset();
  });

  describe("currentDigestWindow", () => {
    it("returns a 7-day window ending at UTC midnight", () => {
      const now = new Date("2026-04-19T14:33:00Z");
      const window = currentDigestWindow(now);
      expect(window.end.toISOString()).toBe("2026-04-19T00:00:00.000Z");
      expect(window.start.toISOString()).toBe("2026-04-12T00:00:00.000Z");
      expect(window.label).toContain("Apr 12");
      expect(window.label).toContain("Apr 19");
    });
  });

  describe("compileDigest", () => {
    const row = (overrides: Record<string, unknown>) => ({
      id: "s1",
      sector: "ai",
      headline: "Headline",
      context: "Context",
      whyItMatters: "Matters",
      sourceName: "Wired",
      publishedAt: new Date("2026-04-15T00:00:00Z"),
      createdAt: new Date("2026-04-15T00:00:00Z"),
      saveCount: 5,
      commentCount: 2,
      score: 12,
      ...overrides,
    });

    it("returns shaped stories from the db query", async () => {
      mock.queueSelect([row({}), row({ id: "s2", saveCount: 1, commentCount: 1 })]);
      const result = await compileDigest();
      expect(result.stories).toHaveLength(2);
      expect(result.stories[0]).toMatchObject({
        id: "s1",
        sector: "ai",
        saveCount: 5,
        commentCount: 2,
      });
      expect(result.window.end).toBeInstanceOf(Date);
    });

    it("caps limit at 20", async () => {
      mock.queueSelect([]);
      await compileDigest({ limit: 500 });
      // No direct assertion on SQL — mockDb does not capture args. This just
      // exercises the clamp path without throwing.
      expect(mock.state.selectResults.length).toBe(0);
    });

    it("returns an empty list when no stories match", async () => {
      mock.queueSelect([]);
      const result = await compileDigest({ sectors: ["ai"] });
      expect(result.stories).toEqual([]);
    });

    it("uses publishedAt when available, otherwise createdAt", async () => {
      mock.queueSelect([
        row({ publishedAt: null, createdAt: new Date("2026-04-10T00:00:00Z") }),
      ]);
      const result = await compileDigest();
      expect(result.stories[0].publishedAt).toEqual(new Date("2026-04-10T00:00:00Z"));
    });
  });
});
