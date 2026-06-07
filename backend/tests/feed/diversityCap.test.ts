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
  CLASS_WINDOW,
  MAX_PER_CLASS,
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

// A non-"news" ingested class (THE LAUNCH). Uncapped by the class cap, so it
// can be pulled up to break a run of plain news.
function launch(id: string, source: string): TestRow {
  return {
    id,
    primarySourceName: source,
    sourceType: "ingested",
    contentType: "launch",
  };
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
    // the top of the ranking (5 of the top 9), the rest of the pool is
    // varied. Rank-greedy backfill must spread the firehose to ≤2 per
    // window using the next-ranked other-source events, with no window
    // anywhere exceeding the cap. (At cap=2/window=20 the most firehose a
    // 57-item feed can legally hold is one pair per 20 positions, so the
    // cluster is sized to stay spreadable rather than hit the degenerate
    // best-effort fallback.)
    const input: TestRow[] = [
      ingested("f0", "Firehose"),
      ingested("f1", "Firehose"),
      ingested("f2", "Firehose"),
      ingested("o0", "OutletA"),
      ingested("f3", "Firehose"),
      ingested("f4", "Firehose"),
      ingested("o1", "OutletB"),
      ingested("o2", "OutletC"),
      ingested("o3", "OutletD"),
    ];
    // Pad the tail with unique sources so the firehose has room to spread.
    for (let i = 0; i < 48; i++) input.push(ingested(`u${i}`, `Unique${i}`));

    const out = applyDiversityCap(input, MAX_PER_SOURCE, DIVERSITY_WINDOW);

    expect(maxSourceRunInAnyWindow(out, DIVERSITY_WINDOW)).toBeLessThanOrEqual(
      MAX_PER_SOURCE,
    );
    expect(idSet(out)).toEqual(idSet(input));
    // The first two firehose items keep their lead positions; the cap
    // only relocates the overflow.
    const firehosePositions = out
      .map((r, i) => ({ r, i }))
      .filter((x) => x.r.primarySourceName === "Firehose")
      .map((x) => x.i);
    expect(firehosePositions.slice(0, 2)).toEqual([0, 1]);
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

  it("(h) per-class cap pulls non-news up past clustered news", () => {
    // 6 plain-news items from distinct sources (so the source cap is inert)
    // then one launch ranked last. With MAX_PER_CLASS.news=5 over
    // CLASS_WINDOW=8, the 6th news can't share the top window, so the
    // lower-ranked launch is pulled up ahead of it.
    const input: TestRow[] = [
      ingested("n0", "S0"),
      ingested("n1", "S1"),
      ingested("n2", "S2"),
      ingested("n3", "S3"),
      ingested("n4", "S4"),
      ingested("n5", "S5"),
      launch("l0", "PH"),
    ];
    const out = applyDiversityCap(input);
    const idx = (id: string): number => out.findIndex((r) => r.id === id);
    // The launch (ranked last) is pulled ahead of the 6th news item.
    expect(idx("l0")).toBeLessThan(idx("n5"));
    expect(idSet(out)).toEqual(idSet(input));
  });

  it("(i) the class cap never breaks the source invariant", () => {
    // Mixed classes with one firehose source over-represented. Even with the
    // class layer active, the layered fallback keeps the source cap intact:
    // no source exceeds MAX_PER_SOURCE in any source window.
    const input: TestRow[] = [
      ingested("f0", "Firehose"),
      ingested("f1", "Firehose"),
      ingested("f2", "Firehose"),
      launch("l0", "PH"),
      ingested("f3", "Firehose"),
      launch("l1", "PH2"),
    ];
    for (let i = 0; i < 30; i++) input.push(ingested(`u${i}`, `U${i}`));
    const out = applyDiversityCap(input, MAX_PER_SOURCE, DIVERSITY_WINDOW);
    expect(maxSourceRunInAnyWindow(out, DIVERSITY_WINDOW)).toBeLessThanOrEqual(
      MAX_PER_SOURCE,
    );
    expect(idSet(out)).toEqual(idSet(input));
  });

  it("(g) exposes the spec'd default constants", () => {
    expect(MAX_PER_SOURCE).toBe(2);
    expect(DIVERSITY_WINDOW).toBe(20);
    expect(CLASS_WINDOW).toBe(8);
    expect(MAX_PER_CLASS.news).toBe(5);
  });
});
