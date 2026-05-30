import {
  accessibleThesisOf,
  filingDateOf,
  earningsReactionExternalId,
  scopeAndSort,
  createEarningsReactionGenerator,
  EARNINGS_REACTION_SLUG,
  MAX_REACTION_POSTS_PER_RUN,
  MAX_EVENTS_CONSIDERED,
  REACTION_SECTORS,
  type EarningsEventRow,
  type EarningsReactionOutput,
  type AuthorOutcome,
} from "../../src/jobs/ingestion/generators/earningsReaction";
import type { EarningsReactionInputs } from "../../src/llm/prompts/ingestion/earningsReactionPrompt";
import type { GeneratorDiagnostic } from "../../src/jobs/ingestion/generators/types";

const NOW = new Date("2026-05-30T00:00:00Z");

const post: EarningsReactionOutput = {
  headline: "NVIDIA's data-center revenue cleared every estimate",
  body: "x".repeat(300),
};

function authored(output: EarningsReactionOutput): AuthorOutcome {
  return { status: "authored", output };
}

// A published EDGAR filing event row. Defaults: finance sector, resolved
// company, a recent filing date, a per-tier template. Tests override.
function edgarRow(overrides: Partial<EarningsEventRow> = {}): EarningsEventRow {
  return {
    sector: "finance",
    headline: "Acme Corp 8-K",
    company: "Acme Corp",
    template: JSON.stringify({
      accessible: { thesis: "the one number that mattered", support: "y".repeat(40) },
      briefed: { thesis: "z".repeat(20), support: "z".repeat(40) },
      technical: { thesis: "z".repeat(20), support: "z".repeat(40) },
    }),
    genericCommentary: null,
    whyItMatters: "role-neutral why it matters",
    publishedAt: "2026-05-29T00:00:00Z",
    url: "https://www.sec.gov/filing/acme",
    sourceSlug: "sec-edgar-finance",
    sourceName: "SEC EDGAR",
    ...overrides,
  };
}

describe("accessibleThesisOf", () => {
  it("prefers the per-tier accessible.thesis", () => {
    expect(accessibleThesisOf(edgarRow())).toBe("the one number that mattered");
  });

  it("falls back to generic_commentary when the template is unparseable", () => {
    expect(
      accessibleThesisOf(edgarRow({ template: null, genericCommentary: "generic" })),
    ).toBe("generic");
  });

  it("falls back to why_it_matters when neither template nor generic exists", () => {
    expect(
      accessibleThesisOf(edgarRow({ template: null, genericCommentary: null })),
    ).toBe("role-neutral why it matters");
  });
});

describe("filingDateOf", () => {
  it("returns the published date", () => {
    expect(filingDateOf(edgarRow())).toBe("2026-05-29T00:00:00Z");
  });

  it("returns null when the event has no published date", () => {
    expect(filingDateOf(edgarRow({ publishedAt: null }))).toBeNull();
  });
});

describe("earningsReactionExternalId", () => {
  it("builds the per-filing dedup key from slug + date", () => {
    expect(
      earningsReactionExternalId("sec-edgar-finance", "2026-05-29T12:00:00Z"),
    ).toBe("earnings:sec-edgar-finance:2026-05-29");
  });
});

describe("scopeAndSort", () => {
  it("drops out-of-scope sectors (ai) and sorts newest first", () => {
    const scoped = scopeAndSort([
      edgarRow({ sector: "finance", publishedAt: "2026-05-27T00:00:00Z", headline: "older" }),
      edgarRow({ sector: "finance", publishedAt: "2026-05-29T00:00:00Z", headline: "newer" }),
      edgarRow({ sector: "ai", headline: "ai filing" }),
    ]);
    expect(scoped.map((r) => r.headline)).toEqual(["newer", "older"]);
  });

  it("keeps semis events", () => {
    const scoped = scopeAndSort([edgarRow({ sector: "semiconductors" })]);
    expect(scoped.length).toBe(1);
  });

  it("ignores rows with an unknown sector string", () => {
    expect(scopeAndSort([edgarRow({ sector: "biotech" })]).length).toBe(0);
  });
});

describe("REACTION_SECTORS scope", () => {
  it("covers finance and semiconductors only (no ai)", () => {
    expect([...REACTION_SECTORS].sort()).toEqual(["finance", "semiconductors"]);
  });
});

describe("createEarningsReactionGenerator — end-to-end", () => {
  it("has the seeded registry slug", () => {
    expect(createEarningsReactionGenerator().slug).toBe(EARNINGS_REACTION_SLUG);
  });

  it("authors one post per qualifying filing, carrying reaction payload", async () => {
    const gen = createEarningsReactionGenerator({
      discover: async () => [edgarRow()],
      existingExternalIds: async () => new Set(),
      authorPost: async () => authored(post),
    });
    const candidates = await gen.generate({ now: () => NOW });
    expect(candidates.map((c) => c.externalId)).toEqual([
      "earnings:sec-edgar-finance:2026-05-29",
    ]);
    expect(candidates[0]!.sector).toBe("finance");
    expect(candidates[0]!.url).toBe("https://www.sec.gov/filing/acme");
    expect(candidates[0]!.rawPayload).toMatchObject({
      generator: "earnings-reaction",
      sector: "finance",
      company: "Acme Corp",
      filing_date: "2026-05-29T00:00:00Z",
      source_slug: "sec-edgar-finance",
    });
  });

  it("passes company, thesis, and source name through to the prompt inputs", async () => {
    let captured: EarningsReactionInputs | null = null;
    const gen = createEarningsReactionGenerator({
      discover: async () => [edgarRow({ company: "Globex" })],
      existingExternalIds: async () => new Set(),
      authorPost: async (inputs): Promise<AuthorOutcome> => {
        captured = inputs;
        return authored(post);
      },
    });
    await gen.generate({ now: () => NOW });
    const inputs = captured! as EarningsReactionInputs;
    expect(inputs.company).toBe("Globex");
    expect(inputs.accessibleThesis).toBe("the one number that mattered");
    expect(inputs.sourceName).toBe("SEC EDGAR");
    expect(inputs.filingDate).toBe("2026-05-29T00:00:00Z");
  });

  it("skips a filing with no published date (no stable external_id)", async () => {
    const authorPost = jest.fn(async (): Promise<AuthorOutcome> => authored(post));
    const records: GeneratorDiagnostic[] = [];
    const gen = createEarningsReactionGenerator({
      discover: async () => [edgarRow({ publishedAt: null })],
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
    expect(d?.reason).toBe("no_filing_date");
  });

  it("skips a filing already posted (dedup), without authoring", async () => {
    const authorPost = jest.fn(async (): Promise<AuthorOutcome> => authored(post));
    const records: GeneratorDiagnostic[] = [];
    const gen = createEarningsReactionGenerator({
      discover: async () => [edgarRow()],
      existingExternalIds: async () =>
        new Set(["earnings:sec-edgar-finance:2026-05-29"]),
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

  it("drops a filing whose authoring step returns a model skip", async () => {
    const gen = createEarningsReactionGenerator({
      discover: async () => [edgarRow()],
      existingExternalIds: async () => new Set(),
      authorPost: async (): Promise<AuthorOutcome> => ({
        status: "skipped",
        reason: "no-material-signal",
      }),
    });
    const candidates = await gen.generate({ now: () => NOW });
    expect(candidates).toEqual([]);
  });

  it("considers at most MAX_EVENTS_CONSIDERED filings", async () => {
    const sent: string[] = [];
    const rows: EarningsEventRow[] = Array.from({ length: 5 }, (_, i) =>
      edgarRow({
        headline: `f-${i}`,
        sourceSlug: `sec-edgar-${i}`,
        publishedAt: new Date(
          Date.parse("2026-05-29T00:00:00Z") - i * 3600_000,
        ).toISOString(),
      }),
    );
    const gen = createEarningsReactionGenerator({
      discover: async () => rows,
      existingExternalIds: async () => new Set(),
      authorPost: async (inputs): Promise<AuthorOutcome> => {
        sent.push(inputs.headline);
        return { status: "skipped", reason: "no-material-signal" };
      },
    });
    await gen.generate({ now: () => NOW });
    // Only the top MAX_EVENTS_CONSIDERED reach authoring (all skipped here).
    expect(sent.length).toBe(MAX_EVENTS_CONSIDERED);
    expect(sent[0]).toBe("f-0"); // newest first
  });

  it("caps authored posts at MAX_REACTION_POSTS_PER_RUN", async () => {
    const rows: EarningsEventRow[] = Array.from({ length: 3 }, (_, i) =>
      edgarRow({
        headline: `f-${i}`,
        sourceSlug: `sec-edgar-${i}`,
        publishedAt: new Date(
          Date.parse("2026-05-29T00:00:00Z") - i * 3600_000,
        ).toISOString(),
      }),
    );
    const gen = createEarningsReactionGenerator({
      discover: async () => rows,
      existingExternalIds: async () => new Set(),
      authorPost: async () => authored(post),
    });
    const candidates = await gen.generate({ now: () => NOW });
    expect(candidates.length).toBe(MAX_REACTION_POSTS_PER_RUN);
  });

  it("produces identical candidates whether or not a sink is attached", async () => {
    const deps = {
      discover: async (): Promise<EarningsEventRow[]> => [edgarRow()],
      existingExternalIds: async (): Promise<Set<string>> => new Set(),
      authorPost: async (): Promise<AuthorOutcome> => authored(post),
    };
    const withSink = await createEarningsReactionGenerator(deps).generate({
      now: () => NOW,
      onDiagnostic: () => undefined,
    });
    const without = await createEarningsReactionGenerator(deps).generate({
      now: () => NOW,
    });
    expect(withSink.map((c) => c.externalId)).toEqual(
      without.map((c) => c.externalId),
    );
  });
});
