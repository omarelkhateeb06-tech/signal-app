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
  runAggregation,
  toIsoWeek,
  weekBounds,
  processAggregationJob,
  getEligibleAggregateSector,
} from "../src/jobs/aggregationJob";

describe("aggregationJob", () => {
  beforeEach(() => {
    mock.reset();
  });

  describe("toIsoWeek", () => {
    it("returns the ISO week for a mid-week date", () => {
      // Wednesday 2026-04-15 is in ISO week 16 of 2026.
      expect(toIsoWeek(new Date("2026-04-15T12:00:00Z"))).toBe("2026-W16");
    });

    it("handles Jan 1 that belongs to the previous ISO year", () => {
      // Jan 1 2027 is a Friday — ISO week belongs to 2026-W53.
      expect(toIsoWeek(new Date("2027-01-01T12:00:00Z"))).toBe("2026-W53");
    });
  });

  describe("weekBounds", () => {
    it("returns Monday-start inclusive and next-Monday exclusive", () => {
      const { start, end } = weekBounds("2026-W16");
      // 2026-W16 starts Monday 2026-04-13 UTC.
      expect(start.toISOString()).toBe("2026-04-13T00:00:00.000Z");
      expect(end.toISOString()).toBe("2026-04-20T00:00:00.000Z");
    });

    it("throws on a malformed ISO week string", () => {
      expect(() => weekBounds("2026-16")).toThrow(/invalid ISO week/);
      expect(() => weekBounds("2026-W1")).toThrow(/invalid ISO week/);
    });
  });

  describe("getEligibleAggregateSector", () => {
    it("returns the sector for a known value", () => {
      expect(getEligibleAggregateSector("ai")).toBe("ai");
      expect(getEligibleAggregateSector("finance")).toBe("finance");
      expect(getEligibleAggregateSector("semiconductors")).toBe("semiconductors");
    });

    it("returns null for an unknown sector", () => {
      expect(getEligibleAggregateSector("biotech")).toBeNull();
      expect(getEligibleAggregateSector("")).toBeNull();
    });
  });

  describe("runAggregation", () => {
    it("upserts one row per known sector, zero-filling missing sectors", async () => {
      // DB returns only ai + finance — semiconductors should be zero-filled.
      mock.queueSelect([
        { sector: "ai", storyCount: 7 },
        { sector: "finance", storyCount: 3 },
      ]);
      mock.queueInsert([]);

      const result = await runAggregation({ period: "2026-W16" });

      expect(result.period).toBe("2026-W16");
      expect(result.processed).toBe(3);
      const bySector = Object.fromEntries(
        result.sectors.map((s) => [s.sector, s.storyCount]),
      );
      expect(bySector).toEqual({ ai: 7, finance: 3, semiconductors: 0 });
      expect(result.sectors.every((s) => s.saveCount === 0)).toBe(true);
    });

    it("ignores stories in sectors outside the known enum", async () => {
      // "biotech" appears in raw results but must not leak into the output.
      mock.queueSelect([
        { sector: "ai", storyCount: 2 },
        { sector: "biotech", storyCount: 99 },
      ]);
      mock.queueInsert([]);

      const result = await runAggregation({ period: "2026-W16" });
      const sectors = result.sectors.map((s) => s.sector);
      expect(sectors).not.toContain("biotech");
      expect(sectors.sort()).toEqual(["ai", "finance", "semiconductors"]);
    });

    it("defaults to the ISO week of `now` when period is not passed", async () => {
      mock.queueSelect([{ sector: "ai", storyCount: 1 }]);
      mock.queueInsert([]);

      const result = await runAggregation({
        now: new Date("2026-04-15T12:00:00Z"),
      });
      expect(result.period).toBe("2026-W16");
    });

    it("emits zero-counts when the DB returns no rows for the week", async () => {
      mock.queueSelect([]);
      mock.queueInsert([]);

      const result = await runAggregation({ period: "2026-W16" });
      expect(result.sectors.every((s) => s.storyCount === 0)).toBe(true);
    });
  });

  describe("processAggregationJob", () => {
    it("forwards the period option through to runAggregation", async () => {
      mock.queueSelect([]);
      mock.queueInsert([]);

      const result = await processAggregationJob({ period: "2026-W16" });
      expect(result.period).toBe("2026-W16");
    });
  });
});
