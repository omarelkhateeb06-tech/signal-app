import {
  NATIVE_DAILY_CAP,
  planDailyCap,
  applyDailyCap,
  checkDailyCap,
} from "../../src/jobs/ingestion/generators/dailyCap";

const NOW = new Date("2026-05-30T12:00:00Z");

describe("NATIVE_DAILY_CAP", () => {
  it("is the documented 25/day ceiling", () => {
    expect(NATIVE_DAILY_CAP).toBe(25);
  });
});

describe("planDailyCap", () => {
  it("reports remaining budget when under the cap", () => {
    expect(planDailyCap(3, 10)).toEqual({
      used: 3,
      remaining: 7,
      exhausted: false,
    });
  });

  it("is exhausted exactly at the cap", () => {
    expect(planDailyCap(10, 10)).toEqual({
      used: 10,
      remaining: 0,
      exhausted: true,
    });
  });

  it("floors remaining at 0 and stays exhausted past the cap", () => {
    expect(planDailyCap(13, 10)).toEqual({
      used: 13,
      remaining: 0,
      exhausted: true,
    });
  });
});

describe("applyDailyCap", () => {
  it("returns all candidates when they fit the remaining budget", () => {
    expect(applyDailyCap([1, 2], 5)).toEqual([1, 2]);
  });

  it("truncates to the remaining budget", () => {
    expect(applyDailyCap([1, 2, 3], 2)).toEqual([1, 2]);
  });

  it("returns nothing when no budget remains", () => {
    expect(applyDailyCap([1, 2, 3], 0)).toEqual([]);
  });
});

describe("checkDailyCap", () => {
  it("counts today's native events via the injected reader", async () => {
    const countTodayNativeEvents = jest.fn(async () => 4);
    const plan = await checkDailyCap(NOW, NATIVE_DAILY_CAP, {
      countTodayNativeEvents,
    });
    expect(countTodayNativeEvents).toHaveBeenCalledWith(NOW);
    expect(plan).toEqual({ used: 4, remaining: 21, exhausted: false });
  });

  it("reports exhausted when today's count meets the cap", async () => {
    const plan = await checkDailyCap(NOW, NATIVE_DAILY_CAP, {
      countTodayNativeEvents: async () => 25,
    });
    expect(plan.exhausted).toBe(true);
    expect(plan.remaining).toBe(0);
  });

  it("honors a custom cap", async () => {
    const plan = await checkDailyCap(NOW, 3, {
      countTodayNativeEvents: async () => 2,
    });
    expect(plan).toEqual({ used: 2, remaining: 1, exhausted: false });
  });
});
