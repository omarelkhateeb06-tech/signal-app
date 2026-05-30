import {
  accessibleThesisOf,
  groupBySector,
  arxivSynthesisExternalId,
  createArxivSynthesisGenerator,
  ARXIV_SYNTHESIS_SLUG,
  MAX_SYNTHESIS_POSTS_PER_RUN,
  MIN_PAPERS_PER_SECTOR,
  MAX_PAPERS_IN_CONTEXT,
  SYNTHESIS_SECTORS,
  type ArxivEventRow,
  type ArxivSynthesisOutput,
  type AuthorOutcome,
} from "../../src/jobs/ingestion/generators/arxivSynthesis";
import {
  isoWeekParts,
  isoWeekOf,
  weekLabelOf,
} from "../../src/jobs/ingestion/generators/isoWeek";
import type {
  ArxivSynthesisInputs,
  ArxivPaperInput,
} from "../../src/llm/prompts/ingestion/arxivSynthesisPrompt";
import type { GeneratorDiagnostic } from "../../src/jobs/ingestion/generators/types";

const NOW = new Date("2026-05-30T00:00:00Z"); // 2026-W22, Saturday

const post: ArxivSynthesisOutput = {
  headline: "The week's AI research converged on inference-time compute",
  body: "x".repeat(300),
};

function authored(output: ArxivSynthesisOutput): AuthorOutcome {
  return { status: "authored", output };
}

// A published arXiv event row. Defaults describe an AI-sector paper with a
// per-tier template carrying an accessible thesis. Tests override fields.
function arxivRow(overrides: Partial<ArxivEventRow> = {}): ArxivEventRow {
  return {
    sector: "ai",
    headline: "A Paper About Scaling Laws",
    template: JSON.stringify({
      accessible: { thesis: "Bigger context wins.", support: "y".repeat(40) },
      briefed: { thesis: "z".repeat(20), support: "z".repeat(40) },
      technical: { thesis: "z".repeat(20), support: "z".repeat(40) },
    }),
    genericCommentary: "generic fallback take",
    whyItMatters: "role-neutral why it matters",
    publishedAt: "2026-05-28T00:00:00Z",
    url: "https://arxiv.org/abs/2605.00001",
    ...overrides,
  };
}

describe("isoWeek helpers", () => {
  it("computes the ISO week parts (Thursday-anchored, UTC)", () => {
    expect(isoWeekParts(NOW)).toEqual({ year: 2026, week: 22 });
  });

  it("formats an ISO-week string with zero-padded week", () => {
    expect(isoWeekOf(NOW)).toBe("2026-W22");
    expect(isoWeekOf(new Date("2026-01-05T00:00:00Z"))).toBe("2026-W02");
  });

  it("carries the ISO year across the Jan boundary", () => {
    // 2026-01-01 is a Thursday → ISO week 2026-W01.
    expect(isoWeekOf(new Date("2026-01-01T00:00:00Z"))).toBe("2026-W01");
    // 2025-12-29 (Monday) is in ISO week 2026-W01.
    expect(isoWeekOf(new Date("2025-12-29T00:00:00Z"))).toBe("2026-W01");
  });

  it("labels the Monday of the ISO week", () => {
    expect(weekLabelOf(NOW)).toBe("week of May 25, 2026");
  });
});

describe("accessibleThesisOf", () => {
  it("prefers the per-tier accessible.thesis", () => {
    expect(accessibleThesisOf(arxivRow())).toBe("Bigger context wins.");
  });

  it("falls back to generic_commentary when the template is unparseable", () => {
    expect(
      accessibleThesisOf(arxivRow({ template: null })),
    ).toBe("generic fallback take");
  });

  it("falls back to why_it_matters when neither template nor generic exists", () => {
    expect(
      accessibleThesisOf(
        arxivRow({ template: null, genericCommentary: null }),
      ),
    ).toBe("role-neutral why it matters");
  });
});

describe("groupBySector", () => {
  it("keeps only scoped sectors (drops finance) and sorts newest first", () => {
    const grouped = groupBySector([
      arxivRow({ sector: "ai", publishedAt: "2026-05-20T00:00:00Z", headline: "older" }),
      arxivRow({ sector: "ai", publishedAt: "2026-05-29T00:00:00Z", headline: "newer" }),
      arxivRow({ sector: "finance", headline: "finance paper" }),
      arxivRow({ sector: "semiconductors", headline: "semi paper" }),
    ]);
    expect([...grouped.keys()].sort()).toEqual(["ai", "semiconductors"]);
    expect(grouped.get("ai")!.map((r) => r.headline)).toEqual(["newer", "older"]);
  });

  it("ignores rows with an unknown sector string", () => {
    const grouped = groupBySector([arxivRow({ sector: "biotech" })]);
    expect(grouped.size).toBe(0);
  });
});

describe("arxivSynthesisExternalId", () => {
  it("builds the weekly dedup key", () => {
    expect(arxivSynthesisExternalId("ai", "2026-W22")).toBe(
      "arxiv-synthesis:ai:2026-W22",
    );
  });
});

describe("SYNTHESIS_SECTORS scope", () => {
  it("covers AI and Semiconductors only (no finance)", () => {
    expect([...SYNTHESIS_SECTORS]).toEqual(["ai", "semiconductors"]);
  });
});

describe("createArxivSynthesisGenerator — end-to-end", () => {
  it("has the seeded registry slug", () => {
    expect(createArxivSynthesisGenerator().slug).toBe(ARXIV_SYNTHESIS_SLUG);
  });

  it("authors one post per qualifying sector, carrying synthesis payload", async () => {
    const gen = createArxivSynthesisGenerator({
      discover: async () => [
        arxivRow({ sector: "ai", headline: "ai-1" }),
        arxivRow({ sector: "ai", headline: "ai-2" }),
        arxivRow({ sector: "semiconductors", headline: "semi-1" }),
        arxivRow({ sector: "semiconductors", headline: "semi-2" }),
      ],
      existingExternalIds: async () => new Set(),
      authorPost: async () => authored(post),
    });
    const candidates = await gen.generate({ now: () => NOW });
    expect(candidates.map((c) => c.externalId)).toEqual([
      "arxiv-synthesis:ai:2026-W22",
      "arxiv-synthesis:semiconductors:2026-W22",
    ]);
    expect(candidates[0]!.sector).toBe("ai");
    expect(candidates[0]!.rawPayload).toMatchObject({
      generator: "arxiv-synthesis",
      sector: "ai",
      iso_week: "2026-W22",
      paper_count: 2,
    });
    // url points at the newest paper in context.
    expect(candidates[0]!.url).toBe("https://arxiv.org/abs/2605.00001");
  });

  it("rejects a sector with too few papers (no authoring)", async () => {
    const authorPost = jest.fn(async (): Promise<AuthorOutcome> => authored(post));
    const records: GeneratorDiagnostic[] = [];
    const gen = createArxivSynthesisGenerator({
      discover: async () => [arxivRow({ sector: "ai", headline: "lonely" })],
      existingExternalIds: async () => new Set(),
      authorPost,
    });
    const candidates = await gen.generate({
      now: () => NOW,
      onDiagnostic: (r) => records.push(r),
    });
    expect(candidates).toEqual([]);
    expect(authorPost).not.toHaveBeenCalled();
    const aiDiscover = records.find(
      (r) => r.stage === "discover" && r.identifier === "arxiv:ai",
    );
    expect(aiDiscover?.decision).toBe("reject");
    expect(aiDiscover?.reason).toBe("too_few_papers");
  });

  it("skips a week already posted (dedup), without authoring", async () => {
    const authorPost = jest.fn(async (): Promise<AuthorOutcome> => authored(post));
    const records: GeneratorDiagnostic[] = [];
    const gen = createArxivSynthesisGenerator({
      discover: async () => [
        arxivRow({ sector: "ai", headline: "ai-1" }),
        arxivRow({ sector: "ai", headline: "ai-2" }),
      ],
      existingExternalIds: async () =>
        new Set(["arxiv-synthesis:ai:2026-W22"]),
      authorPost,
    });
    const candidates = await gen.generate({
      now: () => NOW,
      onDiagnostic: (r) => records.push(r),
    });
    expect(candidates).toEqual([]);
    expect(authorPost).not.toHaveBeenCalled();
    const q = records.find((r) => r.stage === "qualify");
    expect(q?.decision).toBe("reject");
    expect(q?.reason).toBe("already_posted");
  });

  it("assembles context from at most MAX_PAPERS_IN_CONTEXT newest papers", async () => {
    const rows: ArxivEventRow[] = Array.from({ length: 8 }, (_, i) =>
      arxivRow({
        sector: "ai",
        headline: `ai-${i}`,
        publishedAt: new Date(
          Date.parse("2026-05-29T00:00:00Z") - i * 86_400_000,
        ).toISOString(),
      }),
    );
    let captured: ArxivSynthesisInputs | null = null;
    const gen = createArxivSynthesisGenerator({
      discover: async () => rows,
      existingExternalIds: async () => new Set(),
      authorPost: async (inputs): Promise<AuthorOutcome> => {
        captured = inputs;
        return authored(post);
      },
    });
    await gen.generate({ now: () => NOW });
    expect(captured).not.toBeNull();
    const inputs = captured! as ArxivSynthesisInputs;
    // paperCount reports the full window; only the top N reach the prompt.
    expect(inputs.paperCount).toBe(8);
    expect(inputs.papers.length).toBe(MAX_PAPERS_IN_CONTEXT);
    expect(inputs.papers[0]!.title).toBe("ai-0"); // newest first
    expect(inputs.papers.every((p: ArxivPaperInput) => p.accessibleThesis.length > 0)).toBe(true);
  });

  it("drops a sector whose authoring step returns a model skip", async () => {
    const gen = createArxivSynthesisGenerator({
      discover: async () => [
        arxivRow({ sector: "ai", headline: "ai-1" }),
        arxivRow({ sector: "ai", headline: "ai-2" }),
        arxivRow({ sector: "semiconductors", headline: "semi-1" }),
        arxivRow({ sector: "semiconductors", headline: "semi-2" }),
      ],
      existingExternalIds: async () => new Set(),
      authorPost: async (inputs): Promise<AuthorOutcome> =>
        inputs.sector === "ai"
          ? { status: "skipped", reason: "no-coherent-theme" }
          : authored(post),
    });
    const candidates = await gen.generate({ now: () => NOW });
    expect(candidates.map((c) => c.externalId)).toEqual([
      "arxiv-synthesis:semiconductors:2026-W22",
    ]);
  });

  it("never emits more than MAX_SYNTHESIS_POSTS_PER_RUN", async () => {
    const gen = createArxivSynthesisGenerator({
      discover: async () => [
        arxivRow({ sector: "ai", headline: "ai-1" }),
        arxivRow({ sector: "ai", headline: "ai-2" }),
        arxivRow({ sector: "semiconductors", headline: "semi-1" }),
        arxivRow({ sector: "semiconductors", headline: "semi-2" }),
      ],
      existingExternalIds: async () => new Set(),
      authorPost: async () => authored(post),
    });
    const candidates = await gen.generate({ now: () => NOW });
    expect(candidates.length).toBeLessThanOrEqual(MAX_SYNTHESIS_POSTS_PER_RUN);
  });

  it("produces identical candidates whether or not a sink is attached", async () => {
    const deps = {
      discover: async (): Promise<ArxivEventRow[]> => [
        arxivRow({ sector: "ai", headline: "ai-1" }),
        arxivRow({ sector: "ai", headline: "ai-2" }),
      ],
      existingExternalIds: async (): Promise<Set<string>> => new Set(),
      authorPost: async (): Promise<AuthorOutcome> => authored(post),
    };
    const withSink = await createArxivSynthesisGenerator(deps).generate({
      now: () => NOW,
      onDiagnostic: () => undefined,
    });
    const without = await createArxivSynthesisGenerator(deps).generate({
      now: () => NOW,
    });
    expect(withSink.map((c) => c.externalId)).toEqual(
      without.map((c) => c.externalId),
    );
  });

  it("MIN_PAPERS_PER_SECTOR is the documented floor of 2", () => {
    expect(MIN_PAPERS_PER_SECTOR).toBe(2);
  });
});
