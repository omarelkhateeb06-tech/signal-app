// Issue #86 — reader-friendly EDGAR titles/excerpts. Unit-tests the pure
// humanizers so the feed never again shows raw "APPLE INC — 10-Q (2026-...)".
import {
  humanizeCompanyName,
  formLabel,
  humanDate,
  buildEdgarTitle,
  buildEdgarSummary,
} from "../../src/jobs/ingestion/adapters/secEdgarJson";

describe("humanizeCompanyName", () => {
  it("title-cases and drops a single legal suffix", () => {
    expect(humanizeCompanyName("NVIDIA CORP")).toBe("Nvidia");
    expect(humanizeCompanyName("APPLE INC")).toBe("Apple");
    expect(humanizeCompanyName("ADVANCED MICRO DEVICES INC")).toBe(
      "Advanced Micro Devices",
    );
  });

  it("drops stacked legal suffixes", () => {
    expect(
      humanizeCompanyName("TAIWAN SEMICONDUCTOR MANUFACTURING CO LTD"),
    ).toBe("Taiwan Semiconductor Manufacturing");
  });

  it("strips the EDGAR state-of-incorporation suffix", () => {
    expect(humanizeCompanyName("ACME CORP /DE/")).toBe("Acme");
  });

  it("preserves ampersands and never strips the whole name", () => {
    expect(humanizeCompanyName("PROCTER & GAMBLE CO")).toBe("Procter & Gamble");
    expect(humanizeCompanyName("CO")).toBe("Co"); // degenerate input kept
  });
});

describe("formLabel", () => {
  it("maps known forms to plain English", () => {
    expect(formLabel("10-K")).toBe("annual report (10-K)");
    expect(formLabel("10-Q")).toBe("quarterly report (10-Q)");
    expect(formLabel("8-K")).toBe("material-event filing (8-K)");
    expect(formLabel("S-1")).toBe("IPO registration (S-1)");
  });
  it("falls back gracefully for unknown forms", () => {
    expect(formLabel("13F")).toBe("13F filing");
  });
});

describe("humanDate", () => {
  it("formats an ISO date", () => {
    expect(humanDate("2026-06-01")).toBe("June 1, 2026");
    expect(humanDate("2026-12-31")).toBe("December 31, 2026");
  });
  it("returns the input unchanged when unparseable", () => {
    expect(humanDate("not-a-date")).toBe("not-a-date");
  });
});

describe("buildEdgarTitle / buildEdgarSummary", () => {
  it("composes a clean title", () => {
    expect(buildEdgarTitle("APPLE INC", "10-Q")).toBe(
      "Apple — quarterly report (10-Q)",
    );
  });
  it("composes a readable excerpt sentence", () => {
    expect(buildEdgarSummary("NVIDIA CORP", "8-K", "2026-06-01")).toBe(
      "Nvidia filed its material-event filing (8-K) with the SEC on June 1, 2026.",
    );
  });
  it("omits the date phrase when the filing date is missing", () => {
    expect(buildEdgarSummary("APPLE INC", "10-K", "")).toBe(
      "Apple filed its annual report (10-K) with the SEC.",
    );
  });
});
