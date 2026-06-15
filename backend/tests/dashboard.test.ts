import { shapeDashboard } from "../src/controllers/dashboardController";

describe("shapeDashboard", () => {
  it("maps sector + volume rows and sums the 30d total", () => {
    const result = shapeDashboard(
      [
        { sector: "ai", count: 40 },
        { sector: "finance", count: 25 },
        { sector: "semiconductors", count: 15 },
      ],
      [
        { date: "2026-06-13", count: 5 },
        { date: "2026-06-14", count: 8 },
      ],
    );
    expect(result.total_events_30d).toBe(80);
    expect(result.sector_counts).toEqual([
      { sector: "ai", count: 40 },
      { sector: "finance", count: 25 },
      { sector: "semiconductors", count: 15 },
    ]);
    expect(result.volume_by_day).toEqual([
      { date: "2026-06-13", count: 5 },
      { date: "2026-06-14", count: 8 },
    ]);
  });

  it("coerces string counts (pg numeric) to numbers", () => {
    const result = shapeDashboard([{ sector: "ai", count: "12" }], [
      { date: "2026-06-14", count: "3" },
    ]);
    expect(result.sector_counts[0]).toEqual({ sector: "ai", count: 12 });
    expect(result.total_events_30d).toBe(12);
    expect(result.volume_by_day[0]).toEqual({ date: "2026-06-14", count: 3 });
  });

  it("handles an empty corpus", () => {
    const result = shapeDashboard([], []);
    expect(result).toEqual({
      total_events_30d: 0,
      sector_counts: [],
      volume_by_day: [],
    });
  });
});
