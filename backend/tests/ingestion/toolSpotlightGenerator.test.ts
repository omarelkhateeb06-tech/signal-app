import {
  collapseTools,
  coveredRepoKeys,
  toolSpotlightExternalId,
  createToolSpotlightGenerator,
  TOOL_SPOTLIGHT_SLUG,
  MIN_HN_SCORE,
  type ToolDiscoveryRow,
  type ToolSpotlightOutput,
  type AuthorOutcome,
} from "../../src/jobs/ingestion/generators/toolSpotlight";
import type { ToolSpotlightInputs } from "../../src/llm/prompts/ingestion/toolSpotlightPrompt";
import type { GeneratorDiagnostic } from "../../src/jobs/ingestion/generators/types";

const NOW = new Date("2026-05-31T12:00:00Z");

const post: ToolSpotlightOutput = {
  headline: "This local-first vector store is worth an afternoon this week",
  body: "x".repeat(300),
};

function authored(output: ToolSpotlightOutput): AuthorOutcome {
  return { status: "authored", output };
}

function row(overrides: Partial<ToolDiscoveryRow> = {}): ToolDiscoveryRow {
  return {
    url: "https://github.com/acme/widget",
    title: "Show HN: Widget — a local-first vector store",
    hnScore: 250,
    hnComments: 120,
    ...overrides,
  };
}

describe("collapseTools", () => {
  it("keeps the highest-HN-score sighting of a repo and sorts descending", () => {
    const tools = collapseTools([
      row({ url: "https://github.com/acme/widget", hnScore: 100 }),
      row({ url: "https://github.com/acme/widget/issues/3", hnScore: 300 }),
      row({ url: "https://github.com/other/lib", hnScore: 200 }),
    ]);
    expect(tools.map((t) => t.fullName)).toEqual(["acme/widget", "other/lib"]);
    expect(tools[0]!.hnScore).toBe(300);
  });

  it("reports unparseable (non-repo) URLs and drops them", () => {
    const seen: string[] = [];
    const tools = collapseTools(
      [row({ url: "https://github.com/explore" }), row({ url: "https://github.com/a/b" })],
      (u) => seen.push(u),
    );
    expect(tools.map((t) => t.fullName)).toEqual(["a/b"]);
    expect(seen).toEqual(["https://github.com/explore"]);
  });
});

describe("coveredRepoKeys", () => {
  it("builds lowercased repo keys from event URLs", () => {
    const keys = coveredRepoKeys([
      "https://github.com/Acme/Widget",
      "https://example.com/not-a-repo",
    ]);
    expect(keys.has("acme/widget")).toBe(true);
    expect(keys.size).toBe(1);
  });
});

describe("toolSpotlightExternalId", () => {
  it("is repo-keyed with no date component", () => {
    expect(toolSpotlightExternalId("acme/widget")).toBe(
      "tool-spotlight:acme/widget",
    );
  });
});

describe("createToolSpotlightGenerator — end-to-end", () => {
  it("has the seeded registry slug", () => {
    expect(createToolSpotlightGenerator().slug).toBe(TOOL_SPOTLIGHT_SLUG);
  });

  it("spotlights the strongest uncovered tool", async () => {
    let captured: ToolSpotlightInputs | null = null;
    const gen = createToolSpotlightGenerator({
      discover: async () => [
        row({ url: "https://github.com/acme/widget", hnScore: 400, title: "Widget" }),
        row({ url: "https://github.com/other/lib", hnScore: 200, title: "Lib" }),
      ],
      coveredUrls: async () => [],
      existingExternalIds: async () => new Set(),
      authorPost: async (inputs): Promise<AuthorOutcome> => {
        captured = inputs;
        return authored(post);
      },
    });
    const candidates = await gen.generate({ now: () => NOW });
    expect(candidates.map((c) => c.externalId)).toEqual([
      "tool-spotlight:acme/widget",
    ]);
    expect(candidates[0]!.sector).toBe("ai");
    expect(candidates[0]!.url).toBe("https://github.com/acme/widget");
    expect(candidates[0]!.rawPayload).toMatchObject({
      generator: "tool-spotlight",
      full_name: "acme/widget",
      repo_key: "acme/widget",
    });
    const inputs = captured! as ToolSpotlightInputs;
    expect(inputs.fullName).toBe("acme/widget");
    expect(inputs.hnScore).toBe(400);
  });

  it("skips tools already covered by an event", async () => {
    const authorPost = jest.fn(async (): Promise<AuthorOutcome> => authored(post));
    const records: GeneratorDiagnostic[] = [];
    const gen = createToolSpotlightGenerator({
      discover: async () => [row({ url: "https://github.com/acme/widget", hnScore: 400 })],
      coveredUrls: async () => ["https://github.com/acme/widget"],
      existingExternalIds: async () => new Set(),
      authorPost,
    });
    const candidates = await gen.generate({
      now: () => NOW,
      onDiagnostic: (r) => records.push(r),
    });
    expect(candidates).toEqual([]);
    expect(authorPost).not.toHaveBeenCalled();
    const q = records.find((r) => r.stage === "qualify");
    expect(q?.reason).toBe("already_covered");
  });

  it("rejects tools below the community-signal floor", async () => {
    const authorPost = jest.fn(async (): Promise<AuthorOutcome> => authored(post));
    const gen = createToolSpotlightGenerator({
      discover: async () => [
        row({ url: "https://github.com/acme/widget", hnScore: MIN_HN_SCORE - 1 }),
      ],
      coveredUrls: async () => [],
      existingExternalIds: async () => new Set(),
      authorPost,
    });
    const candidates = await gen.generate({ now: () => NOW });
    expect(candidates).toEqual([]);
    expect(authorPost).not.toHaveBeenCalled();
  });

  it("skips a tool already spotlighted (dedup)", async () => {
    const authorPost = jest.fn(async (): Promise<AuthorOutcome> => authored(post));
    const records: GeneratorDiagnostic[] = [];
    const gen = createToolSpotlightGenerator({
      discover: async () => [row({ url: "https://github.com/acme/widget", hnScore: 400 })],
      coveredUrls: async () => [],
      existingExternalIds: async () => new Set(["tool-spotlight:acme/widget"]),
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

  it("falls through to the next strongest tool when the top is covered", async () => {
    let captured: ToolSpotlightInputs | null = null;
    const gen = createToolSpotlightGenerator({
      discover: async () => [
        row({ url: "https://github.com/acme/widget", hnScore: 400, title: "Widget" }),
        row({ url: "https://github.com/other/lib", hnScore: 200, title: "Lib" }),
      ],
      coveredUrls: async () => ["https://github.com/acme/widget"],
      existingExternalIds: async () => new Set(),
      authorPost: async (inputs): Promise<AuthorOutcome> => {
        captured = inputs;
        return authored(post);
      },
    });
    const candidates = await gen.generate({ now: () => NOW });
    expect(candidates.map((c) => c.externalId)).toEqual([
      "tool-spotlight:other/lib",
    ]);
    expect((captured! as ToolSpotlightInputs).fullName).toBe("other/lib");
  });

  it("returns nothing when the model declines (skip)", async () => {
    const gen = createToolSpotlightGenerator({
      discover: async () => [row({ url: "https://github.com/acme/widget", hnScore: 400 })],
      coveredUrls: async () => [],
      existingExternalIds: async () => new Set(),
      authorPost: async (): Promise<AuthorOutcome> => ({
        status: "skipped",
        reason: "title-too-thin",
      }),
    });
    const candidates = await gen.generate({ now: () => NOW });
    expect(candidates).toEqual([]);
  });
});
