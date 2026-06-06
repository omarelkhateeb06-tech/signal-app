import { githubAdapter, buildCandidate } from "../../src/jobs/ingestion/adapters/github";
import type { AdapterContext } from "../../src/jobs/ingestion/types";

function makeCtx(config: Record<string, unknown> = {}): AdapterContext {
  return {
    sourceId: "00000000-0000-0000-0000-000000000099",
    slug: "github-ai",
    adapterType: "github_api",
    endpoint: "https://api.github.com/search/repositories",
    config,
    lastPolledAt: null,
  };
}

interface RepoFixture {
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  language?: string | null;
  topics?: string[];
  pushed_at?: string;
}

// Mock fetch: every GitHub search URL returns `itemsByCall` in sequence (so we
// can hand different topics different result sets), or a fixed list.
function mockGithub(
  itemsPerCall: RepoFixture[][] | RepoFixture[],
  status = 200,
): jest.Mock {
  let call = 0;
  const fn = jest.fn(async (_url: string) => {
    const items = Array.isArray(itemsPerCall[0])
      ? (itemsPerCall as RepoFixture[][])[call++] ?? []
      : (itemsPerCall as RepoFixture[]);
    return {
      status,
      headers: { get: () => "application/json" },
      json: async () => ({ items }),
    } as unknown as Response;
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

function repo(name: string, overrides: Partial<RepoFixture> = {}): RepoFixture {
  return {
    full_name: name,
    html_url: `https://github.com/${name}`,
    description: `${name} does a thing`,
    stargazers_count: 500,
    language: "Python",
    topics: ["llm"],
    pushed_at: "2026-06-01T00:00:00Z",
    ...overrides,
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("githubAdapter", () => {
  it("maps a repo to a candidate (externalId, url, body from metadata)", async () => {
    mockGithub([repo("owner/cascade", { stargazers_count: 1200, language: "Rust", topics: ["llm", "inference"] })]);
    const { candidates } = await githubAdapter(makeCtx({ topics: ["llm"] }));
    expect(candidates).toHaveLength(1);
    const c = candidates[0];
    expect(c.externalId).toBe("github:owner/cascade");
    expect(c.url).toBe("https://github.com/owner/cascade");
    expect(c.title).toContain("owner/cascade");
    expect(c.bodyText).toContain("Rust");
    expect(c.bodyText).toContain("1200 stars");
    expect(c.bodyText).toContain("inference");
    expect(c.publishedAt).toEqual(new Date("2026-06-01T00:00:00Z"));
  });

  it("issues one search per topic and dedups by full_name across topics", async () => {
    const fn = mockGithub([
      [repo("a/one"), repo("a/two")], // topic 1
      [repo("a/two"), repo("a/three")], // topic 2 (a/two repeats)
    ]);
    const { candidates } = await githubAdapter(makeCtx({ topics: ["llm", "rag"] }));
    expect(fn).toHaveBeenCalledTimes(2);
    const ids = candidates.map((c) => c.externalId).sort();
    expect(ids).toEqual(["github:a/one", "github:a/three", "github:a/two"]);
  });

  it("ranks by stars and caps at maxRepos", async () => {
    mockGithub([
      [
        repo("a/lo", { stargazers_count: 100 }),
        repo("a/hi", { stargazers_count: 9000 }),
        repo("a/mid", { stargazers_count: 500 }),
      ],
    ]);
    const { candidates } = await githubAdapter(makeCtx({ topics: ["llm"], maxRepos: 2 }));
    expect(candidates.map((c) => c.externalId)).toEqual([
      "github:a/hi",
      "github:a/mid",
    ]);
  });

  it("encodes topic + window + min-stars into the search query", async () => {
    const fn = mockGithub([[repo("a/x")]]);
    await githubAdapter(makeCtx({ topics: ["ai-agents"], minStars: 250, windowDays: 30 }));
    const url = (fn.mock.calls[0] as unknown as string[])[0];
    expect(url).toContain("topic%3Aai-agents");
    expect(url).toContain("stars%3A%3E%3D250");
    expect(url).toContain("pushed%3A%3E%3D");
  });

  it("throws a stable failure string on a 4xx (rate limit)", async () => {
    mockGithub([[repo("a/x")]], 403);
    await expect(githubAdapter(makeCtx({ topics: ["llm"] }))).rejects.toThrow("http_4xx");
  });

  it("buildCandidate handles a null description", () => {
    const c = buildCandidate({
      full_name: "a/b",
      html_url: "https://github.com/a/b",
      description: null,
      stargazers_count: 42,
    });
    expect(c.title).toBe("a/b");
    expect(c.summary).toBeNull();
    expect(c.bodyText).toContain("42 stars");
  });
});
