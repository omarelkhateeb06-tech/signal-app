// Phase 12 — source-diversity cap tests.
//
// `applyDiversityCap` is a pure reorder over the already-ranked event
// pool. Note on window size: the cap is "≤ maxPerSource per source in
// any window of `windowSize` positions". When the whole input fits
// inside one window (input length ≤ windowSize), a source with more than
// `maxPerSource` items CANNOT be spread out — there is nowhere outside
// the window to move them. That is the degenerate case, and the cap
// falls back to best-effort (never drops items). So the displacement /
// invariant cases below use a small explicit `windowSize` (where moving
// an item past the window is actually possible), and the default-param
// cases use large, satisfiable inputs.

import {
  applyDiversityCap,
  MAX_PER_SOURCE,
  DIVERSITY_WINDOW,
  NATIVE_SOURCE_TYPE,
  type DiversityItem,
} from "../../src/feed/diversityCap";

interface TestRow extends DiversityItem {
  id: string;
}

function ingested(id: string, source: string): TestRow {
  return { id, primarySourceName: source, sourceType: "ingested" };
}

function native(id: string): TestRow {
  return { id, primarySourceName: "SIGNAL", sourceType: NATIVE_SOURCE_TYPE };
}

/** Max occurrences of any one non-native source in any window of `size`. */
function maxSourceRunInAnyWindow(rows: TestRow[], size: number): number {
  let worst = 0;
  for (let start = 0; start < rows.length; start++) {
    const window = rows.slice(start, start + size);
    const counts = new Map<string, number>();
    for (const r of window) {
      if (r.sourceType === NATIVE_SOURCE_TYPE) continue;
      const key = r.primarySourceName ?? "(unknown)";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const c of counts.values()) worst = Math.max(worst, c);
  }
  return worst;
}

const idSet = (rows: TestRow[]): Set<string> => new Set(rows.map((r) => r.id));

describe("applyDiversityCap", () => {
  it("(a) displaces the over-cap item and backfills with the next source", () => {
    // window=4, cap=2: three A's clustered at the top, then B and C.
    // The 3rd A must drop below B and C; B (higher-ranked) backfills first.
    const input: TestRow[] = [
      ingested("a1", "A"),
      ingested("a2", "A"),
      ingested("a3", "A"),
      ingested("b1", "B"),
      ingested("c1", "C"),
    ];
    const out = applyDiversityCap(input, 2, 4);

    // First two slots keep the two highest A's (cap allows 2).
    expect(out[0].id).toBe("a1");
    expect(out[1].id).toBe("a2");
    // a3 is pushed past both backfilled sources.
    const idx = (id: string): number => out.findIndex((r) => r.id === id);
    expect(idx("a3")).toBeGreaterThan(idx("b1"));
    expect(idx("a3")).toBeGreaterThan(idx("c1"));
    // Invariant holds for the chosen window, and nothing was dropped.
    expect(maxSourceRunInAnyWindow(out, 4)).toBeLessThanOrEqual(2);
    expect(idSet(out)).toEqual(idSet(input));
  });

  it("(b) spreads an over-represented source clustered at the top", () => {
    // The realistic shape the cap targets: one firehose source dominates
    // the top of the ranking (8 of the top 12), the rest of the pool is
    // varied. Rank-greedy backfill must spread the firehose to ≤3 per
    // window using the next-ranked other-source events, with no window
    // anywhere exceeding the cap.
    const input: TestRow[] = [
      ingested("f0", "Firehose"),
      ingested("f1", "Firehose"),
      ingested("f2", "Firehose"),
      ingested("o0", "OutletA"),
      ingested("f3", "Firehose"),
      ingested("f4", "Firehose"),
      ingested("o1", "OutletB"),
      ingested("f5", "Firehose"),
      ingested("f6", "Firehose"),
      ingested("o2", "OutletC"),
      ingested("f7", "Firehose"),
      ingested("o3", "OutletD"),
    ];
    // Pad the tail with unique sources so the firehose has room to spread.
    for (let i = 0; i < 48; i++) input.push(ingested(`u${i}`, `Unique${i}`));

    const out = applyDiversityCap(input, MAX_PER_SOURCE, DIVERSITY_WINDOW);

    expect(maxSourceRunInAnyWindow(out, DIVERSITY_WINDOW)).toBeLessThanOrEqual(
      MAX_PER_SOURCE,
    );
    expect(idSet(out)).toEqual(idSet(input));
    // The first three firehose items keep their lead positions; the cap
    // only relocates the overflow.
    const firehosePositions = out
      .map((r, i) => ({ r, i }))
      .filter((x) => x.r.primarySourceName === "Firehose")
      .map((x) => x.i);
    expect(firehosePositions.slice(0, 3)).toEqual([0, 1, 2]);
  });

  it("(c) never caps native posts — a run of natives survives in order", () => {
    const input: TestRow[] = [];
    for (let i = 0; i < 10; i++) input.push(native(`n${i}`));
    const out = applyDiversityCap(input, MAX_PER_SOURCE, DIVERSITY_WINDOW);
    expect(out.map((r) => r.id)).toEqual(input.map((r) => r.id));
  });

  it("(c2) natives interleaved with a capped source are never displaced", () => {
    // window=4, cap=2. Natives spacing the A's must all stay put, and the
    // invariant (over non-native sources) still holds.
    const input: TestRow[] = [
      ingested("a1", "A"),
      native("n1"),
      ingested("a2", "A"),
      native("n2"),
      ingested("a3", "A"),
      native("n3"),
    ];
    const out = applyDiversityCap(input, 2, 4);
    // Every native is still present.
    for (const n of ["n1", "n2", "n3"]) {
      expect(out.some((r) => r.id === n)).toBe(true);
    }
    expect(maxSourceRunInAnyWindow(out, 4)).toBeLessThanOrEqual(2);
    expect(idSet(out)).toEqual(idSet(input));
  });

  it("(d) returns a permutation — no items dropped or duplicated", () => {
    const input: TestRow[] = [];
    for (let i = 0; i < 50; i++) input.push(ingested(`x${i}`, `S${i % 4}`));
    const out = applyDiversityCap(input, MAX_PER_SOURCE, DIVERSITY_WINDOW);
    expect(out).toHaveLength(input.length);
    expect(idSet(out)).toEqual(idSet(input));
  });

  it("(e) degenerate single-source input is returned intact (no drops)", () => {
    // Unsatisfiable under window 20 (8 of one source, all in one window):
    // the fallback must keep every item rather than discard the overflow.
    const input: TestRow[] = [];
    for (let i = 0; i < 8; i++) input.push(ingested(`a${i}`, "A"));
    const out = applyDiversityCap(input, MAX_PER_SOURCE, DIVERSITY_WINDOW);
    expect(out).toHaveLength(8);
    expect(idSet(out)).toEqual(idSet(input));
  });

  it("(f) empty input returns empty output", () => {
    expect(applyDiversityCap([], MAX_PER_SOURCE, DIVERSITY_WINDOW)).toEqual([]);
  });

  it("(g) exposes the spec'd default constants", () => {
    expect(MAX_PER_SOURCE).toBe(3);
    expect(DIVERSITY_WINDOW).toBe(20);
  });
});
