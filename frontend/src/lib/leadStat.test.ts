import { describe, expect, it } from "vitest";

import { leadStat } from "./leadStat";

describe("leadStat", () => {
  it("extracts a percentage", () => {
    expect(leadStat("Margins fell 8% this quarter.")).toBe("8%");
    expect(leadStat("Revenue grew 12.4% YoY.")).toBe("12.4%");
  });

  it("extracts a currency figure with a magnitude word", () => {
    expect(leadStat("They booked $4.2 billion in bookings.")).toBe(
      "$4.2 billion",
    );
    expect(leadStat("A $900M buyback was announced.")).toBe("$900M");
  });

  it("returns the earliest figure when both appear", () => {
    expect(leadStat("Margins fell 8% as $2 billion in costs hit.")).toBe("8%");
    expect(leadStat("$2 billion in costs drove a 8% margin drop.")).toBe(
      "$2 billion",
    );
  });

  it("normalizes internal whitespace", () => {
    expect(leadStat("guidance of $ 4.2 billion")).toBe("$ 4.2 billion");
    expect(leadStat("a 12 % move")).toBe("12 %");
  });

  it("returns null when there is no figure", () => {
    expect(leadStat("No numbers here at all.")).toBeNull();
    expect(leadStat("")).toBeNull();
    expect(leadStat(null)).toBeNull();
    expect(leadStat(undefined)).toBeNull();
  });
});
