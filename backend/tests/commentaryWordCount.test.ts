import { validateWordBudgets } from "../src/services/commentaryWordCount";

const BUDGETS = { thesis: 40, support: 90 };

function words(n: number): string {
  return Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
}

describe("validateWordBudgets", () => {
  it("returns no warnings when both fields are within ±20%", () => {
    const out = validateWordBudgets(
      { thesis: words(40), support: words(90) },
      BUDGETS,
    );
    expect(out).toEqual([]);
  });

  it("returns no warnings exactly at the threshold", () => {
    // 20% over thesis budget = 48 words; 20% under support budget = 72.
    const out = validateWordBudgets(
      { thesis: words(48), support: words(72) },
      BUDGETS,
    );
    expect(out).toEqual([]);
  });

  it("flags over-budget thesis with direction=over", () => {
    const out = validateWordBudgets(
      { thesis: words(60), support: words(90) },
      BUDGETS,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      field: "thesis",
      direction: "over",
      actualWords: 60,
      budgetWords: 40,
    });
    expect(out[0]!.driftRatio).toBeCloseTo(0.5, 5);
  });

  it("flags under-budget support with direction=under", () => {
    const out = validateWordBudgets(
      { thesis: words(40), support: words(20) },
      BUDGETS,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      field: "support",
      direction: "under",
      actualWords: 20,
      budgetWords: 90,
    });
    expect(out[0]!.driftRatio).toBeLessThan(0);
  });

  it("flags both fields when both drift past threshold", () => {
    const out = validateWordBudgets(
      { thesis: words(80), support: words(10) },
      BUDGETS,
    );
    expect(out).toHaveLength(2);
    const fields = out.map((w) => w.field).sort();
    expect(fields).toEqual(["support", "thesis"]);
  });

  it("treats whitespace runs as a single delimiter", () => {
    // 3 words, regardless of whitespace shape.
    const tightBudget = { thesis: 3, support: 3 };
    const out = validateWordBudgets(
      { thesis: "a   b\n\nc", support: "x\ty z" },
      tightBudget,
    );
    expect(out).toEqual([]);
  });

  it("flags a zero-word field as under (avoiding div-by-zero)", () => {
    const out = validateWordBudgets(
      { thesis: "", support: words(90) },
      BUDGETS,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      field: "thesis",
      direction: "under",
      actualWords: 0,
    });
  });
});
