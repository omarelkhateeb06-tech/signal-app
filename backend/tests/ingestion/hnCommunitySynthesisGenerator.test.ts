import {
  commentaryOf,
  groupBySector,
  hnSynthesisExternalId,
  createHnCommunitySynthesisGenerator,
  HN_SYNTHESIS_SLUG,
  MAX_SYNTHESIS_POSTS_PER_RUN,
  MIN_THREADS_PER_SECTOR,
  MAX_THREADS_IN_CONTEXT,
  MIN_HN_SCORE,
  SYNTHESIS_SECTORS,
  type HnThreadRow,
  type HnSynthesisOutput,
  type AuthorOutcome,
} from "../../src/jobs/ingestion/generators/hnCommunitySynthesis";
import type {
  HnSynthesisInputs,
  HnThreadInput,
} from "../../src/llm/prompts/ingestion/hnSynthesisPrompt";
import type { GeneratorDiagnostic } from "../../src/jobs/ingestion/generators/types";

const NOW = new Date("2026-05-30T00:00:00Z"); // 2026-W22

const post: HnSynthesisOutput = {
  headline: "The AI community spent the week arguing about agent reliability",
  body: "x".repeat(300),
};

function authored(output: HnSynthesisOutput): AuthorOutcome {
  return { status: "authored", output };
}

// A published HN non-repo thread row. Defaults: AI sector, above the score
// floor, no resolved-event template (the common case). Tests override.
function hnRow(overrides: Partial<HnThreadRow> = {}): HnThreadRow {
  return {
    sector: "ai",
    title: "Show HN: a thing",
    score: 250,
    comments: 120,
    template: null,
    genericCommentary: null,
    url: "https://example.com/article",
    ...overrides,
  };
}

describe("commentaryOf", () => {
  it("prefers the resolved event's accessible thesis", () => {
    const row = hnRow({
      template: JSON.stringify({
        accessible: { thesis: "the distilled take", support: "y".repeat(40) },
        briefed: { thesis: "z".repeat(20), support: "z".repeat(40) },
        technical: { thesis: "z".repeat(20), support: "z".repeat(40) },
      }),
    });
    expect(commentaryOf(row)).toBe("the distilled take");
  });

  it("falls back to generic_commentary when no template", () => {
    expect(commentaryOf(hnRow({ genericCommentary: "generic" }))).toBe("generic");
  });

  it("returns null when the thread never became an event", () => {
    expect(commentaryOf(hnRow())).toBeNull();
  });
});

describe("groupBySector", () => {
  it("drops rows below the score floor", () => {
    const grouped = groupBySector([
      hnRow({ sector: "ai", score: MIN_HN_SCORE - 1, title: "weak" }),
      hnRow({ sector: "ai", score: MIN_HN_SCORE, title: "edge" }),
    ]);
    expect(grouped.get("ai")!.map((r) => r.title)).toEqual(["edge"]);
  });

  it("sorts each sector by score descending", () => {
    const grouped = groupBySector([
      hnRow({ sector: "ai", score: 150, title: "mid" }),
      hnRow({ sector: "ai", score: 400, title: "top" }),
      hnRow({ sector: "ai", score: 200, title: "low" }),
    ]);
    expect(grouped.get("ai")!.map((r) => r.score)).toEqual([400, 200, 150]);
  });

  it("groups across all three scoped sectors", () => {
    const grouped = groupBySector([
      hnRow({ sector: "ai" }),
      hnRow({ sector: "finance" }),
      hnRow({ sector: "semiconductors" }),
    ]);
    expect([...grouped.keys()].sort()).toEqual([
      "ai",
      "finance",
      "semiconductors",
    ]);
  });

  it("respects a custom score floor argument", () => {
    const grouped = groupBySector(
      [hnRow({ sector: "ai", score: 80 })],
      50,
    );
    expect(grouped.get("ai")!.length).toBe(1);
  });
});

describe("hnSynthesisExternalId", () => {
  it("builds the weekly dedup key", () => {
    expect(hnSynthesisExternalId("finance", "2026-W22")).toBe(
      "hn-synthesis:finance:2026-W22",
    );
  });
});

describe("SYNTHESIS_SECTORS scope", () => {
  it("covers all three sectors", () => {
    expect([...SYNTHESIS_SECTORS].sort()).toEqual([
      "ai",
      "finance",
      "semiconductors",
    ]);
  });
});

describe("createHnCommunitySynthesisGenerator — end-to-end", () => {
  it("has the seeded registry slug", () => {
    expect(createHnCommunitySynthesisGenerator().slug).toBe(HN_SYNTHESIS_SLUG);
  });

  it("authors one post for a sector with enough qualifying threads", async () => {
    const gen = createHnCommunitySynthesisGenerator({
      discover: async () => [
        hnRow({ sector: "ai", score: 400, title: "a" }),
        hnRow({ sector: "ai", score: 300, title: "b" }),
        hnRow({ sector: "ai", score: 200, title: "c" }),
      ],
      existingExternalIds: async () => new Set(),
      authorPost: async () => authored(post),
    });
    const candidates = await gen.generate({ now: () => NOW });
    expect(candidates.map((c) => c.externalId)).toEqual([
      "hn-synthesis:ai:2026-W22",
    ]);
    expect(candidates[0]!.rawPayload).toMatchObject({
      generator: "hn-community-synthesis",
      sector: "ai",
      iso_week: "2026-W22",
      thread_count: 3,
    });
    // url is the highest-scored thread's link.
    expect(candidates[0]!.url).toBe("https://example.com/article");
  });

  it("rejects a sector with too few threads (no authoring)", async () => {
    const authorPost = jest.fn(async (): Promise<AuthorOutcome> => authored(post));
    const records: GeneratorDiagnostic[] = [];
    const gen = createHnCommunitySynthesisGenerator({
      discover: async () => [
        hnRow({ sector: "ai", title: "a" }),
        hnRow({ sector: "ai", title: "b" }),
      ],
      existingExternalIds: async () => new Set(),
      authorPost,
    });
    const candidates = await gen.generate({
      now: () => NOW,
      onDiagnostic: (r) => records.push(r),
    });
    expect(candidates).toEqual([]);
    expect(authorPost).not.toHaveBeenCalled();
    const d = records.find(
      (r) => r.stage === "discover" && r.identifier === "hn:ai",
    );
    expect(d?.decision).toBe("reject");
    expect(d?.reason).toBe("too_few_threads");
  });

  it("treats below-floor threads as not counting toward the minimum", async () => {
    const authorPost = jest.fn(async (): Promise<AuthorOutcome> => authored(post));
    const gen = createHnCommunitySynthesisGenerator({
      discover: async () => [
        hnRow({ sector: "ai", score: 400, title: "a" }),
        hnRow({ sector: "ai", score: 300, title: "b" }),
        hnRow({ sector: "ai", score: MIN_HN_SCORE - 1, title: "weak" }),
      ],
      existingExternalIds: async () => new Set(),
      authorPost,
    });
    const candidates = await gen.generate({ now: () => NOW });
    // Only 2 clear the floor → below MIN_THREADS_PER_SECTOR → no post.
    expect(candidates).toEqual([]);
    expect(authorPost).not.toHaveBeenCalled();
  });

  it("skips a week already posted (dedup)", async () => {
    const authorPost = jest.fn(async (): Promise<AuthorOutcome> => authored(post));
    const records: GeneratorDiagnostic[] = [];
    const gen = createHnCommunitySynthesisGenerator({
      discover: async () => [
        hnRow({ sector: "ai", title: "a" }),
        hnRow({ sector: "ai", title: "b" }),
        hnRow({ sector: "ai", title: "c" }),
      ],
      existingExternalIds: async () => new Set(["hn-synthesis:ai:2026-W22"]),
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

  it("assembles context from at most MAX_THREADS_IN_CONTEXT top threads", async () => {
    const rows: HnThreadRow[] = Array.from({ length: 9 }, (_, i) =>
      hnRow({ sector: "ai", score: 500 - i * 10, title: `t-${i}` }),
    );
    let captured: HnSynthesisInputs | null = null;
    const gen = createHnCommunitySynthesisGenerator({
      discover: async () => rows,
      existingExternalIds: async () => new Set(),
      authorPost: async (inputs): Promise<AuthorOutcome> => {
        captured = inputs;
        return authored(post);
      },
    });
    await gen.generate({ now: () => NOW });
    expect(captured).not.toBeNull();
    const inputs = captured! as HnSynthesisInputs;
    expect(inputs.threadCount).toBe(9);
    expect(inputs.threads.length).toBe(MAX_THREADS_IN_CONTEXT);
    expect(inputs.threads[0]!.title).toBe("t-0"); // highest score first
    expect(
      inputs.threads.every((t: HnThreadInput) => typeof t.score === "number"),
    ).toBe(true);
  });

  it("caps at MAX_SYNTHESIS_POSTS_PER_RUN across sectors", async () => {
    const sectorRows = (sector: HnThreadRow["sector"]): HnThreadRow[] => [
      hnRow({ sector, score: 400, title: `${sector}-a` }),
      hnRow({ sector, score: 300, title: `${sector}-b` }),
      hnRow({ sector, score: 200, title: `${sector}-c` }),
    ];
    const gen = createHnCommunitySynthesisGenerator({
      discover: async () => [
        ...sectorRows("ai"),
        ...sectorRows("finance"),
        ...sectorRows("semiconductors"),
      ],
      existingExternalIds: async () => new Set(),
      authorPost: async () => authored(post),
    });
    const candidates = await gen.generate({ now: () => NOW });
    expect(candidates.length).toBe(MAX_SYNTHESIS_POSTS_PER_RUN);
  });

  it("passes the resolved-event take through to the prompt inputs", async () => {
    let captured: HnSynthesisInputs | null = null;
    const gen = createHnCommunitySynthesisGenerator({
      discover: async () => [
        hnRow({ sector: "ai", score: 400, title: "a", genericCommentary: "took on agents" }),
        hnRow({ sector: "ai", score: 300, title: "b" }),
        hnRow({ sector: "ai", score: 200, title: "c" }),
      ],
      existingExternalIds: async () => new Set(),
      authorPost: async (inputs): Promise<AuthorOutcome> => {
        captured = inputs;
        return authored(post);
      },
    });
    await gen.generate({ now: () => NOW });
    const inputs = captured! as HnSynthesisInputs;
    expect(inputs.threads[0]!.accessibleCommentary).toBe("took on agents");
    expect(inputs.threads[1]!.accessibleCommentary).toBeNull();
  });

  it("MIN_THREADS_PER_SECTOR is the documented floor of 3", () => {
    expect(MIN_THREADS_PER_SECTOR).toBe(3);
  });
});
