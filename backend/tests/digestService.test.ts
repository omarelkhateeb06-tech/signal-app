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

import {
  compileDailyDigest,
  currentDailyWindow,
} from "../src/services/digestService";

describe("digestService (12i daily)", () => {
  beforeEach(() => {
    mock.reset();
  });

  describe("currentDailyWindow", () => {
    it("returns a 24h window ending at the call moment with a 'Mon D' label", () => {
      const now = new Date("2026-05-17T11:00:00Z");
      const window = currentDailyWindow(now);
      expect(window.sentAt.toISOString()).toBe("2026-05-17T11:00:00.000Z");
      expect(window.start.toISOString()).toBe("2026-05-16T11:00:00.000Z");
      expect(window.label).toBe("May 17");
    });
  });

  describe("compileDailyDigest", () => {
    const storyRow = (overrides: Record<string, unknown> = {}) => ({
      id: "s-ai-1",
      sector: "ai",
      headline: "Story headline",
      whyItMatters: "Role-neutral fallback.",
      genericCommentary: "Pre-generated generic body.",
      sourceName: "Wired",
      publishedAt: new Date("2026-05-17T08:00:00Z"),
      createdAt: new Date("2026-05-17T08:00:00Z"),
      ...overrides,
    });

    const eventRow = (overrides: Record<string, unknown> = {}) => ({
      id: "e-fin-1",
      sector: "finance",
      headline: "Event headline",
      whyItMatters: "Role-neutral fallback.",
      genericCommentary: "Pre-generated generic body.",
      sourceName: "Bloomberg",
      publishedAt: new Date("2026-05-17T07:30:00Z"),
      createdAt: new Date("2026-05-17T07:30:00Z"),
      effectiveScore: 9.5,
      ...overrides,
    });

    it("merges stories + events and groups the page by sector preserving rank order", async () => {
      // Higher-score event ranks above the baseline-7 story.
      mock.queueSelect([storyRow({ id: "s1", sector: "ai" })]); // stories
      mock.queueSelect([
        eventRow({ id: "e1", sector: "finance", effectiveScore: 11 }),
        eventRow({ id: "e2", sector: "ai", effectiveScore: 8 }),
      ]); // events

      const result = await compileDailyDigest();

      expect(result.stories.map((s) => s.id)).toEqual(["e1", "e2", "s1"]);
      // bySector preserves the rank order — Finance first because
      // its top item ranked highest overall.
      expect(Array.from(result.bySector.keys())).toEqual(["finance", "ai"]);
      expect(result.bySector.get("finance")?.map((s) => s.id)).toEqual(["e1"]);
      expect(result.bySector.get("ai")?.map((s) => s.id)).toEqual(["e2", "s1"]);
    });

    it("prefers generic_commentary over why_it_matters for the body text", async () => {
      mock.queueSelect([
        storyRow({
          whyItMatters: "FALLBACK text.",
          genericCommentary: "Generic body.",
        }),
      ]);
      mock.queueSelect([]); // no events

      const result = await compileDailyDigest();
      expect(result.stories[0].commentary).toBe("Generic body.");
    });

    it("falls back to why_it_matters when generic_commentary is null", async () => {
      mock.queueSelect([
        storyRow({ whyItMatters: "Fallback role-neutral.", genericCommentary: null }),
      ]);
      mock.queueSelect([]);

      const result = await compileDailyDigest();
      expect(result.stories[0].commentary).toBe("Fallback role-neutral.");
    });

    it("returns empty commentary when both sources are null/empty", async () => {
      mock.queueSelect([
        storyRow({ whyItMatters: "", genericCommentary: null }),
      ]);
      mock.queueSelect([]);

      const result = await compileDailyDigest();
      expect(result.stories[0].commentary).toBe("");
    });

    it("caps the page at DAILY_DIGEST_SIZE (default 10)", async () => {
      const many = Array.from({ length: 15 }, (_, i) =>
        eventRow({ id: `e-${i}`, sector: "ai", effectiveScore: 10 - i / 100 }),
      );
      mock.queueSelect([]); // stories empty
      mock.queueSelect(many);

      const result = await compileDailyDigest();
      expect(result.stories).toHaveLength(10);
    });

    it("honors an explicit limit option", async () => {
      const many = Array.from({ length: 5 }, (_, i) =>
        eventRow({ id: `e-${i}`, effectiveScore: 10 - i / 100 }),
      );
      mock.queueSelect([]);
      mock.queueSelect(many);

      const result = await compileDailyDigest({ limit: 3 });
      expect(result.stories).toHaveLength(3);
    });

    it("uses publishedAt when available, otherwise createdAt", async () => {
      mock.queueSelect([
        storyRow({
          publishedAt: null,
          createdAt: new Date("2026-05-17T06:00:00Z"),
        }),
      ]);
      mock.queueSelect([]);

      const result = await compileDailyDigest();
      expect(result.stories[0].publishedAt).toEqual(
        new Date("2026-05-17T06:00:00Z"),
      );
    });

    it("returns an empty page when neither side has rows", async () => {
      mock.queueSelect([]);
      mock.queueSelect([]);
      const result = await compileDailyDigest();
      expect(result.stories).toEqual([]);
      expect(result.bySector.size).toBe(0);
    });
  });
});
