import {
  accessibleThesisOf,
  utcDateKey,
  chainExternalId,
  groupBySector,
  selectBestPair,
  createCrossSectorChainGenerator,
  CROSS_SECTOR_CHAIN_SLUG,
  CHAIN_WINDOW_HOURS,
  MAX_EVENTS_IN_CONTEXT,
  type ChainEventRow,
  type CrossSectorChainOutput,
  type AuthorOutcome,
} from "../../src/jobs/ingestion/generators/crossSectorChain";
import type { CrossSectorChainInputs } from "../../src/llm/prompts/ingestion/crossSectorChainPrompt";
import type { GeneratorDiagnostic } from "../../src/jobs/ingestion/generators/types";

const NOW = new Date("2026-05-31T12:00:00Z");

const post: CrossSectorChainOutput = {
  headline: "A Fed hold is about to reshape semiconductor capex",
  body: "x".repeat(300),
};

function authored(output: CrossSectorChainOutput): AuthorOutcome {
  return { status: "authored", output };
}

// A qualifying ingested event row. Defaults: AI sector, above the quality
// floor, no template (falls back through to why_it_matters). Tests override.
function chainRow(overrides: Partial<ChainEventRow> = {}): ChainEventRow {
  return {
    sector: "ai",
    headline: "A model dropped",
    template: null,
    genericCommentary: null,
    whyItMatters: "it matters",
    publishedAt: "2026-05-31T08:00:00Z",
    url: "https://example.com/event",
    qualityScore: 8,
    ...overrides,
  };
}

describe("accessibleThesisOf", () => {
  it("prefers the per-tier accessible thesis", () => {
    const row = chainRow({
      template: JSON.stringify({
        accessible: { thesis: "the distilled take", support: "y".repeat(40) },
        briefed: { thesis: "z".repeat(20), support: "z".repeat(40) },
        technical: { thesis: "z".repeat(20), support: "z".repeat(40) },
      }),
    });
    expect(accessibleThesisOf(row)).toBe("the distilled take");
  });

  it("falls back to generic_commentary when no template", () => {
    expect(
      accessibleThesisOf(chainRow({ genericCommentary: "generic" })),
    ).toBe("generic");
  });

  it("falls back to why_it_matters when neither present", () => {
    expect(accessibleThesisOf(chainRow())).toBe("it matters");
  });
});

describe("utcDateKey", () => {
  it("renders YYYY-MM-DD in UTC", () => {
    expect(utcDateKey(NOW)).toBe("2026-05-31");
  });
});

describe("chainExternalId", () => {
  it("sorts sectors alphabetically so the key is orientation-stable", () => {
    const a = chainExternalId("semiconductors", "ai", NOW);
    const b = chainExternalId("ai", "semiconductors", NOW);
    expect(a).toBe(b);
    expect(a).toBe("cross-sector-chain:ai-semiconductors:2026-05-31");
  });
});

describe("groupBySector", () => {
  it("groups scoped sectors and sorts each newest-first", () => {
    const grouped = groupBySector([
      chainRow({ sector: "ai", publishedAt: "2026-05-30T00:00:00Z", headline: "old" }),
      chainRow({ sector: "ai", publishedAt: "2026-05-31T00:00:00Z", headline: "new" }),
      chainRow({ sector: "finance" }),
    ]);
    expect(grouped.get("ai")!.map((r) => r.headline)).toEqual(["new", "old"]);
    expect(grouped.get("finance")!.length).toBe(1);
  });

  it("drops out-of-scope sectors", () => {
    const grouped = groupBySector([chainRow({ sector: "biotech" })]);
    expect(grouped.size).toBe(0);
  });
});

describe("selectBestPair", () => {
  it("returns null when fewer than two sectors qualify", () => {
    const grouped = groupBySector([chainRow({ sector: "ai" })]);
    expect(selectBestPair(grouped)).toBeNull();
  });

  it("picks the pair with the most combined events", () => {
    const grouped = groupBySector([
      chainRow({ sector: "ai" }),
      chainRow({ sector: "finance" }),
      chainRow({ sector: "finance" }),
      chainRow({ sector: "semiconductors" }),
      chainRow({ sector: "semiconductors" }),
      chainRow({ sector: "semiconductors" }),
    ]);
    // finance(2)+semis(3)=5 beats ai+semis(4) and ai+finance(3).
    expect(selectBestPair(grouped)).toEqual(["finance", "semiconductors"]);
  });

  it("breaks ties by CANONICAL_PAIRS order (ai+semis first)", () => {
    const grouped = groupBySector([
      chainRow({ sector: "ai" }),
      chainRow({ sector: "finance" }),
      chainRow({ sector: "semiconductors" }),
    ]);
    // All pairs total 2; ai+semiconductors is first in CANONICAL_PAIRS.
    expect(selectBestPair(grouped)).toEqual(["ai", "semiconductors"]);
  });
});

describe("createCrossSectorChainGenerator — end-to-end", () => {
  it("has the seeded registry slug", () => {
    expect(createCrossSectorChainGenerator().slug).toBe(CROSS_SECTOR_CHAIN_SLUG);
  });

  it("authors one chain post for the strongest qualifying pair", async () => {
    let captured: CrossSectorChainInputs | null = null;
    const gen = createCrossSectorChainGenerator({
      discover: async () => [
        chainRow({ sector: "ai", headline: "ai-a", url: "https://x/ai-a" }),
        chainRow({ sector: "semiconductors", headline: "semi-a" }),
      ],
      existingExternalIds: async () => new Set(),
      authorPost: async (inputs): Promise<AuthorOutcome> => {
        captured = inputs;
        return authored(post);
      },
    });
    const candidates = await gen.generate({ now: () => NOW });
    expect(candidates.map((c) => c.externalId)).toEqual([
      "cross-sector-chain:ai-semiconductors:2026-05-31",
    ]);
    // Tagged to the originating (A) sector; CANONICAL orientation is ai first.
    expect(candidates[0]!.sector).toBe("ai");
    expect(candidates[0]!.url).toBe("https://x/ai-a");
    expect(candidates[0]!.rawPayload).toMatchObject({
      generator: "cross-sector-chain",
      sector_a: "ai",
      sector_b: "semiconductors",
      date: "2026-05-31",
    });
    const inputs = captured! as CrossSectorChainInputs;
    expect(inputs.sectorA).toBe("ai");
    expect(inputs.sectorB).toBe("semiconductors");
    expect(inputs.windowLabel).toBe(`the last ${CHAIN_WINDOW_HOURS} hours`);
  });

  it("rejects when no two sectors qualify (no authoring)", async () => {
    const authorPost = jest.fn(async (): Promise<AuthorOutcome> => authored(post));
    const records: GeneratorDiagnostic[] = [];
    const gen = createCrossSectorChainGenerator({
      discover: async () => [chainRow({ sector: "ai" })],
      existingExternalIds: async () => new Set(),
      authorPost,
    });
    const candidates = await gen.generate({
      now: () => NOW,
      onDiagnostic: (r) => records.push(r),
    });
    expect(candidates).toEqual([]);
    expect(authorPost).not.toHaveBeenCalled();
    const d = records.find((r) => r.stage === "discover");
    expect(d?.decision).toBe("reject");
    expect(d?.reason).toBe("no_qualifying_pair");
  });

  it("skips a pair already posted today (dedup)", async () => {
    const authorPost = jest.fn(async (): Promise<AuthorOutcome> => authored(post));
    const records: GeneratorDiagnostic[] = [];
    const gen = createCrossSectorChainGenerator({
      discover: async () => [
        chainRow({ sector: "ai" }),
        chainRow({ sector: "semiconductors" }),
      ],
      existingExternalIds: async () =>
        new Set(["cross-sector-chain:ai-semiconductors:2026-05-31"]),
      authorPost,
    });
    const candidates = await gen.generate({
      now: () => NOW,
      onDiagnostic: (r) => records.push(r),
    });
    expect(candidates).toEqual([]);
    expect(authorPost).not.toHaveBeenCalled();
    const q = records.find((r) => r.stage === "qualify");
    expect(q?.reason).toBe("already_posted");
  });

  it("returns nothing when the model declines (skip)", async () => {
    const gen = createCrossSectorChainGenerator({
      discover: async () => [
        chainRow({ sector: "ai" }),
        chainRow({ sector: "semiconductors" }),
      ],
      existingExternalIds: async () => new Set(),
      authorPost: async (): Promise<AuthorOutcome> => ({
        status: "skipped",
        reason: "no-causal-link",
      }),
    });
    const candidates = await gen.generate({ now: () => NOW });
    expect(candidates).toEqual([]);
  });

  it("feeds at most MAX_EVENTS_IN_CONTEXT events per sector to the prompt", async () => {
    const many = (sector: ChainEventRow["sector"]): ChainEventRow[] =>
      Array.from({ length: 6 }, (_, i) =>
        chainRow({
          sector,
          headline: `${sector}-${i}`,
          publishedAt: `2026-05-31T${String(10 - i).padStart(2, "0")}:00:00Z`,
        }),
      );
    let captured: CrossSectorChainInputs | null = null;
    const gen = createCrossSectorChainGenerator({
      discover: async () => [...many("ai"), ...many("semiconductors")],
      existingExternalIds: async () => new Set(),
      authorPost: async (inputs): Promise<AuthorOutcome> => {
        captured = inputs;
        return authored(post);
      },
    });
    await gen.generate({ now: () => NOW });
    const inputs = captured! as CrossSectorChainInputs;
    expect(inputs.eventCountA).toBe(6);
    expect(inputs.eventCountB).toBe(6);
    expect(inputs.eventsA.length).toBe(MAX_EVENTS_IN_CONTEXT);
    expect(inputs.eventsB.length).toBe(MAX_EVENTS_IN_CONTEXT);
  });
});
