import {
  accessibleThesisOf,
  qualifyAndSort,
  supplyChainSynthesisExternalId,
  dateRangeLabelOf,
  createSupplyChainSynthesisGenerator,
  SUPPLY_CHAIN_SYNTHESIS_SLUG,
  SUPPLY_CHAIN_SECTOR,
  MIN_EVENTS,
  MIN_CORROBORATION,
  MAX_EVENTS_IN_CONTEXT,
  type SupplyChainEventRow,
  type SupplyChainSynthesisOutput,
  type AuthorOutcome,
} from "../../src/jobs/ingestion/generators/supplyChainSynthesis";
import type { SupplyChainSynthesisInputs } from "../../src/llm/prompts/ingestion/supplyChainSynthesisPrompt";
import type { GeneratorDiagnostic } from "../../src/jobs/ingestion/generators/types";

const NOW = new Date("2026-05-30T00:00:00Z"); // 2026-W22

const post: SupplyChainSynthesisOutput = {
  headline: "The real constraint isn't fab capacity — it's CoWoS packaging",
  body: "x".repeat(300),
};

function authored(output: SupplyChainSynthesisOutput): AuthorOutcome {
  return { status: "authored", output };
}

// A corroborated semis event row. Defaults: 2 sources (at the floor), a
// per-tier template, a recent published date. Tests override.
function scRow(overrides: Partial<SupplyChainEventRow> = {}): SupplyChainEventRow {
  return {
    headline: "TSMC raises CoWoS capacity",
    template: JSON.stringify({
      accessible: { thesis: "packaging is the chokepoint", support: "y".repeat(40) },
      briefed: { thesis: "z".repeat(20), support: "z".repeat(40) },
      technical: { thesis: "z".repeat(20), support: "z".repeat(40) },
    }),
    genericCommentary: null,
    whyItMatters: "role-neutral why it matters",
    corroborationCount: 2,
    publishedAt: "2026-05-28T00:00:00Z",
    url: "https://example.com/tsmc",
    ...overrides,
  };
}

describe("accessibleThesisOf", () => {
  it("prefers the per-tier accessible.thesis", () => {
    expect(accessibleThesisOf(scRow())).toBe("packaging is the chokepoint");
  });

  it("falls back to generic_commentary when the template is unparseable", () => {
    expect(
      accessibleThesisOf(scRow({ template: null, genericCommentary: "generic" })),
    ).toBe("generic");
  });

  it("falls back to why_it_matters when neither template nor generic exists", () => {
    expect(
      accessibleThesisOf(scRow({ template: null, genericCommentary: null })),
    ).toBe("role-neutral why it matters");
  });
});

describe("qualifyAndSort", () => {
  it("drops events below the corroboration floor", () => {
    const out = qualifyAndSort([
      scRow({ corroborationCount: MIN_CORROBORATION - 1, headline: "weak" }),
      scRow({ corroborationCount: MIN_CORROBORATION, headline: "edge" }),
    ]);
    expect(out.map((r) => r.headline)).toEqual(["edge"]);
  });

  it("sorts qualifying events newest first", () => {
    const out = qualifyAndSort([
      scRow({ publishedAt: "2026-05-25T00:00:00Z", headline: "older" }),
      scRow({ publishedAt: "2026-05-29T00:00:00Z", headline: "newer" }),
    ]);
    expect(out.map((r) => r.headline)).toEqual(["newer", "older"]);
  });
});

describe("supplyChainSynthesisExternalId", () => {
  it("builds the weekly dedup key", () => {
    expect(supplyChainSynthesisExternalId("2026-W22")).toBe(
      "supply-chain:semis:2026-W22",
    );
  });
});

describe("dateRangeLabelOf", () => {
  it("formats a UTC day-range with the run year", () => {
    const since = new Date("2026-05-23T00:00:00Z");
    expect(dateRangeLabelOf(since, NOW)).toBe("May 23–May 30, 2026");
  });
});

describe("SUPPLY_CHAIN_SECTOR scope", () => {
  it("is semiconductors", () => {
    expect(SUPPLY_CHAIN_SECTOR).toBe("semiconductors");
  });
});

describe("createSupplyChainSynthesisGenerator — end-to-end", () => {
  it("has the seeded registry slug", () => {
    expect(createSupplyChainSynthesisGenerator().slug).toBe(
      SUPPLY_CHAIN_SYNTHESIS_SLUG,
    );
  });

  it("authors one post for enough corroborated events, carrying payload", async () => {
    const gen = createSupplyChainSynthesisGenerator({
      discover: async () => [
        scRow({ headline: "a", corroborationCount: 3 }),
        scRow({ headline: "b", corroborationCount: 2 }),
      ],
      existingExternalIds: async () => new Set(),
      authorPost: async () => authored(post),
    });
    const candidates = await gen.generate({ now: () => NOW });
    expect(candidates.map((c) => c.externalId)).toEqual([
      "supply-chain:semis:2026-W22",
    ]);
    expect(candidates[0]!.sector).toBe("semiconductors");
    expect(candidates[0]!.rawPayload).toMatchObject({
      generator: "supply-chain-synthesis",
      sector: "semiconductors",
      iso_week: "2026-W22",
      event_count: 2,
    });
  });

  it("rejects when too few corroborated events (no authoring)", async () => {
    const authorPost = jest.fn(async (): Promise<AuthorOutcome> => authored(post));
    const records: GeneratorDiagnostic[] = [];
    const gen = createSupplyChainSynthesisGenerator({
      discover: async () => [scRow({ headline: "lonely" })],
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
    expect(d?.reason).toBe("too_few_events");
  });

  it("treats below-floor corroboration as not counting toward the minimum", async () => {
    const authorPost = jest.fn(async (): Promise<AuthorOutcome> => authored(post));
    const gen = createSupplyChainSynthesisGenerator({
      discover: async () => [
        scRow({ headline: "a", corroborationCount: 2 }),
        scRow({ headline: "weak", corroborationCount: 1 }),
      ],
      existingExternalIds: async () => new Set(),
      authorPost,
    });
    // Only 1 clears the floor → below MIN_EVENTS → no post.
    const candidates = await gen.generate({ now: () => NOW });
    expect(candidates).toEqual([]);
    expect(authorPost).not.toHaveBeenCalled();
  });

  it("skips a week already posted (dedup), without authoring", async () => {
    const authorPost = jest.fn(async (): Promise<AuthorOutcome> => authored(post));
    const records: GeneratorDiagnostic[] = [];
    const gen = createSupplyChainSynthesisGenerator({
      discover: async () => [
        scRow({ headline: "a" }),
        scRow({ headline: "b" }),
      ],
      existingExternalIds: async () =>
        new Set(["supply-chain:semis:2026-W22"]),
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

  it("assembles context from at most MAX_EVENTS_IN_CONTEXT events", async () => {
    const rows: SupplyChainEventRow[] = Array.from({ length: 8 }, (_, i) =>
      scRow({
        headline: `e-${i}`,
        corroborationCount: 2,
        publishedAt: new Date(
          Date.parse("2026-05-29T00:00:00Z") - i * 3600_000,
        ).toISOString(),
      }),
    );
    let captured: SupplyChainSynthesisInputs | null = null;
    const gen = createSupplyChainSynthesisGenerator({
      discover: async () => rows,
      existingExternalIds: async () => new Set(),
      authorPost: async (inputs): Promise<AuthorOutcome> => {
        captured = inputs;
        return authored(post);
      },
    });
    await gen.generate({ now: () => NOW });
    const inputs = captured! as SupplyChainSynthesisInputs;
    expect(inputs.eventCount).toBe(8); // full window
    expect(inputs.events.length).toBe(MAX_EVENTS_IN_CONTEXT);
    expect(inputs.events[0]!.headline).toBe("e-0"); // newest first
  });

  it("drops the post when authoring returns a model skip", async () => {
    const gen = createSupplyChainSynthesisGenerator({
      discover: async () => [
        scRow({ headline: "a" }),
        scRow({ headline: "b" }),
      ],
      existingExternalIds: async () => new Set(),
      authorPost: async (): Promise<AuthorOutcome> => ({
        status: "skipped",
        reason: "no-nonobvious-connection",
      }),
    });
    const candidates = await gen.generate({ now: () => NOW });
    expect(candidates).toEqual([]);
  });

  it("produces identical candidates whether or not a sink is attached", async () => {
    const deps = {
      discover: async (): Promise<SupplyChainEventRow[]> => [
        scRow({ headline: "a" }),
        scRow({ headline: "b" }),
      ],
      existingExternalIds: async (): Promise<Set<string>> => new Set(),
      authorPost: async (): Promise<AuthorOutcome> => authored(post),
    };
    const withSink = await createSupplyChainSynthesisGenerator(deps).generate({
      now: () => NOW,
      onDiagnostic: () => undefined,
    });
    const without = await createSupplyChainSynthesisGenerator(deps).generate({
      now: () => NOW,
    });
    expect(withSink.map((c) => c.externalId)).toEqual(
      without.map((c) => c.externalId),
    );
  });

  it("MIN_EVENTS and MIN_CORROBORATION are the documented floors of 2", () => {
    expect(MIN_EVENTS).toBe(2);
    expect(MIN_CORROBORATION).toBe(2);
  });
});
