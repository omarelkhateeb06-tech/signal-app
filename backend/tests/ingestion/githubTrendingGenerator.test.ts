import {
  computeStarVelocity,
  createGithubTrendingGenerator,
  selectTrendingRepos,
  STAR_VELOCITY_THRESHOLD,
  MAX_NATIVE_POSTS_PER_RUN,
  type GithubNativeOutput,
} from "../../src/jobs/ingestion/generators/githubTrending";

// Minimal repo fixture shaped like the GitHub search API subset the
// generator reads. `id` is what dedup keys on.
function repo(
  id: number,
  overrides: Partial<{
    full_name: string;
    html_url: string;
    description: string | null;
    stargazers_count: number;
    language: string | null;
    topics: string[];
    created_at: string;
    pushed_at: string;
  }> = {},
): any {
  return {
    id,
    full_name: `owner/repo-${id}`,
    html_url: `https://github.com/owner/repo-${id}`,
    description: `description ${id}`,
    stargazers_count: 1000,
    language: "Python",
    topics: ["llm"],
    created_at: "2026-05-01T00:00:00Z",
    pushed_at: "2026-05-29T00:00:00Z",
    ...overrides,
  };
}

const NOW = new Date("2026-05-30T00:00:00Z");

describe("computeStarVelocity", () => {
  it("divides stars by age in days", () => {
    // created 2026-05-01, now 2026-05-30 = 29 days; 2900 stars → 100/day.
    expect(
      computeStarVelocity(2900, "2026-05-01T00:00:00Z", NOW),
    ).toBeCloseTo(100, 5);
  });

  it("clamps age to a 1-day floor so a same-day repo doesn't divide by zero", () => {
    // created today → ageDays clamped to 1 → velocity equals star count.
    expect(computeStarVelocity(500, "2026-05-30T00:00:00Z", NOW)).toBe(500);
  });
});

describe("selectTrendingRepos", () => {
  it("dedups by repo id across topic overlap", () => {
    const repos = [repo(1, { stargazers_count: 2900 }), repo(1, { stargazers_count: 2900 })];
    const selected = selectTrendingRepos(repos, NOW);
    expect(selected.length).toBe(1);
  });

  it("drops repos below the velocity threshold", () => {
    // 29 days old. Threshold 50/day → needs >= 1450 stars.
    const repos = [
      repo(1, { stargazers_count: 2900 }), // 100/day — keep
      repo(2, { stargazers_count: 290 }), // 10/day — drop
    ];
    const selected = selectTrendingRepos(repos, NOW);
    expect(selected.map((r) => r.id)).toEqual([1]);
  });

  it("keeps a repo exactly at the threshold", () => {
    // 29 days old × 50/day = 1450 stars → velocity exactly 50.
    const repos = [repo(1, { stargazers_count: 1450 })];
    const selected = selectTrendingRepos(repos, NOW);
    expect(selected.length).toBe(1);
    expect(selected[0]!.starVelocityPerDay).toBeCloseTo(STAR_VELOCITY_THRESHOLD, 5);
  });

  it("sorts by velocity descending and caps at MAX_NATIVE_POSTS_PER_RUN", () => {
    const repos = [
      repo(1, { stargazers_count: 1500 }),
      repo(2, { stargazers_count: 5800 }), // highest velocity
      repo(3, { stargazers_count: 2900 }),
      repo(4, { stargazers_count: 2000 }),
    ];
    const selected = selectTrendingRepos(repos, NOW);
    expect(selected.length).toBe(MAX_NATIVE_POSTS_PER_RUN);
    expect(selected[0]!.id).toBe(2);
  });
});

describe("createGithubTrendingGenerator", () => {
  const post: GithubNativeOutput = {
    headline: "A real headline about the repo",
    body: "x".repeat(300),
  };

  it("emits one NativeCandidate per selected repo with sector=ai", async () => {
    const gen = createGithubTrendingGenerator({
      fetchSearch: async () => [repo(1, { stargazers_count: 2900 })],
      authorPost: async () => post,
    });
    const candidates = await gen.generate({ now: () => NOW });
    expect(candidates.length).toBe(1);
    expect(candidates[0]!.externalId).toBe("github:1");
    expect(candidates[0]!.sector).toBe("ai");
    expect(candidates[0]!.url).toBe("https://github.com/owner/repo-1");
    expect(candidates[0]!.headline).toBe(post.headline);
    expect(candidates[0]!.body).toBe(post.body);
  });

  it("skips a repo whose authoring step returns null (LLM/parse failure)", async () => {
    const gen = createGithubTrendingGenerator({
      fetchSearch: async () => [
        repo(1, { stargazers_count: 2900 }),
        repo(2, { stargazers_count: 5800 }),
      ],
      authorPost: async (inputs) =>
        inputs.fullName === "owner/repo-1" ? null : post,
    });
    const candidates = await gen.generate({ now: () => NOW });
    expect(candidates.map((c) => c.externalId)).toEqual(["github:2"]);
  });

  it("survives a per-topic fetch failure and still emits from healthy topics", async () => {
    let call = 0;
    const gen = createGithubTrendingGenerator({
      fetchSearch: async () => {
        call += 1;
        if (call === 1) throw new Error("network");
        return [repo(1, { stargazers_count: 2900 })];
      },
      authorPost: async () => post,
    });
    const candidates = await gen.generate({ now: () => NOW });
    expect(candidates.length).toBe(1);
  });

  it("carries generation metadata onto rawPayload", async () => {
    const gen = createGithubTrendingGenerator({
      fetchSearch: async () => [repo(7, { stargazers_count: 2900 })],
      authorPost: async () => post,
    });
    const candidates = await gen.generate({ now: () => NOW });
    expect(candidates[0]!.rawPayload).toMatchObject({
      repo_id: 7,
      full_name: "owner/repo-7",
      generator: "github-trending-native",
    });
  });

  it("has the expected registry slug", () => {
    const gen = createGithubTrendingGenerator();
    expect(gen.slug).toBe("github-trending-native");
  });
});
