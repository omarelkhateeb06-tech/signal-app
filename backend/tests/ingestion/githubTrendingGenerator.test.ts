import {
  computeStarVelocity,
  ageDaysOf,
  qualifyRepo,
  preFilterRepo,
  signalsFromRepo,
  escapeLikePattern,
  parseLastPageFromLink,
  createGithubTrendingGenerator,
  DEFAULT_QUALIFY_CONFIG,
  MAX_NATIVE_POSTS_PER_RUN,
  MAX_FINALISTS,
  type RepoSignals,
  type GithubNativeOutput,
} from "../../src/jobs/ingestion/generators/githubTrending";

const NOW = new Date("2026-05-30T00:00:00Z");

// A repo fixture shaped like the GitHub search API subset the generator
// reads. Defaults describe a HEALTHY, qualifying repo: old enough, real
// code weight, organic fork ratio, issue activity. Individual tests
// override fields to model the gamed/junk profiles.
function repo(
  id: number,
  overrides: Partial<{
    full_name: string;
    html_url: string;
    description: string | null;
    stargazers_count: number;
    forks_count: number;
    open_issues_count: number;
    size: number;
    language: string | null;
    topics: string[];
    created_at: string;
    pushed_at: string;
    archived: boolean;
    disabled: boolean;
  }> = {},
): any {
  return {
    id,
    full_name: `owner/repo-${id}`,
    html_url: `https://github.com/owner/repo-${id}`,
    description: `description ${id}`,
    stargazers_count: 4000,
    forks_count: 400, // 0.10 ratio — comfortably organic
    open_issues_count: 50,
    size: 5000, // KB — real code weight
    language: "Python",
    topics: ["llm"],
    created_at: "2025-09-01T00:00:00Z", // ~270 days old at NOW
    pushed_at: "2026-05-29T00:00:00Z",
    archived: false,
    disabled: false,
    ...overrides,
  };
}

function signals(overrides: Partial<RepoSignals> = {}): RepoSignals {
  return {
    stars: 4000,
    forks: 400,
    openIssues: 50,
    sizeKb: 5000,
    ageDays: 270,
    contributors: 20,
    archived: false,
    disabled: false,
    ...overrides,
  };
}

describe("computeStarVelocity (informational only)", () => {
  it("divides stars by age in days", () => {
    expect(
      computeStarVelocity(2900, "2026-05-01T00:00:00Z", NOW),
    ).toBeCloseTo(100, 5);
  });

  it("clamps age to a 1-day floor so a same-day repo doesn't divide by zero", () => {
    expect(computeStarVelocity(500, "2026-05-30T00:00:00Z", NOW)).toBe(500);
  });
});

describe("ageDaysOf", () => {
  it("computes whole-day age from an ISO creation date", () => {
    expect(ageDaysOf("2026-05-20T00:00:00Z", NOW)).toBeCloseTo(10, 5);
  });
});

describe("escapeLikePattern", () => {
  it("escapes LIKE metacharacters so repo names can't widen the match", () => {
    expect(escapeLikePattern("owner/re_po")).toBe("owner/re\\_po");
    expect(escapeLikePattern("a%b_c\\d")).toBe("a\\%b\\_c\\\\d");
  });
});

describe("parseLastPageFromLink", () => {
  it("extracts the rel=last page number (= contributor count at per_page=1)", () => {
    const link =
      '<https://api.github.com/repositories/1/contributors?per_page=1&page=2>; rel="next", ' +
      '<https://api.github.com/repositories/1/contributors?per_page=1&page=37>; rel="last"';
    expect(parseLastPageFromLink(link)).toBe(37);
  });

  it("returns null when no rel=last is present (single page)", () => {
    const link =
      '<https://api.github.com/repositories/1/contributors?per_page=1&page=1>; rel="prev"';
    expect(parseLastPageFromLink(link)).toBeNull();
  });
});

describe("qualifyRepo — the anti-gaming gate", () => {
  it("passes a healthy, corroborated repo", () => {
    expect(qualifyRepo(signals(), true).ok).toBe(true);
  });

  it("passes a healthy repo even uncorroborated when it clears the strict bar", () => {
    // 20 contributors ≥ strict 8, 0.10 fork ratio ≥ strict 0.05,
    // 5000 KB ≥ strict 500, 270 days ≥ strict 90.
    expect(qualifyRepo(signals(), false).ok).toBe(true);
  });

  it("rejects archived repos outright", () => {
    expect(qualifyRepo(signals({ archived: true }), true)).toEqual({
      ok: false,
      reason: "archived",
    });
  });

  it("rejects disabled repos outright", () => {
    expect(qualifyRepo(signals({ disabled: true }), true)).toEqual({
      ok: false,
      reason: "disabled",
    });
  });

  it("rejects a brand-new repo with a star explosion (uncorroborated → strict age)", () => {
    // 40 days old: clears lenient 30 but not strict 90.
    const r = qualifyRepo(signals({ ageDays: 40 }), false);
    expect(r).toEqual({ ok: false, reason: "too_new" });
  });

  it("rejects a thin/empty repo (README-marketing, meme) on size", () => {
    const r = qualifyRepo(signals({ sizeKb: 20 }), true);
    expect(r).toEqual({ ok: false, reason: "too_thin" });
  });

  it("rejects a repo with no issue activity", () => {
    const r = qualifyRepo(signals({ openIssues: 0 }), true);
    expect(r).toEqual({ ok: false, reason: "no_issue_activity" });
  });

  it("rejects stars-without-forks (the classic purchased-star tell)", () => {
    // 198K stars, 40 forks → 0.0002 ratio, far below even the lenient 0.02.
    const r = qualifyRepo(
      signals({ stars: 198_000, forks: 40, contributors: 1 }),
      true,
    );
    expect(r).toEqual({ ok: false, reason: "low_fork_star_ratio" });
  });

  it("rejects a 1-2 contributor 'viral' repo", () => {
    const r = qualifyRepo(signals({ contributors: 2 }), true);
    expect(r).toEqual({ ok: false, reason: "too_few_contributors" });
  });

  it("applies the strict contributor bar when uncorroborated", () => {
    // 5 contributors clears lenient 3 but not strict 8.
    expect(qualifyRepo(signals({ contributors: 5 }), true).ok).toBe(true);
    expect(qualifyRepo(signals({ contributors: 5 }), false)).toEqual({
      ok: false,
      reason: "too_few_contributors",
    });
  });

  it("applies the strict fork-ratio bar when uncorroborated", () => {
    // 0.03 ratio clears lenient 0.02 but not strict 0.05.
    const s = signals({ stars: 10_000, forks: 300 });
    expect(qualifyRepo(s, true).ok).toBe(true);
    expect(qualifyRepo(s, false)).toEqual({
      ok: false,
      reason: "low_fork_star_ratio",
    });
  });
});

describe("qualifyRepo — the three dry-run junk profiles are rejected", () => {
  // The ~198K-star unknown-individual JS repo: enormous stars, almost no
  // forks, single contributor — pure purchased-star shape.
  it("rejects the ~198K-star ECC repo", () => {
    const eccRepo = signals({
      stars: 198_000,
      forks: 35,
      openIssues: 2,
      sizeKb: 800,
      ageDays: 140,
      contributors: 1,
    });
    expect(qualifyRepo(eccRepo, false).ok).toBe(false);
    expect(qualifyRepo(eccRepo, true).ok).toBe(false);
  });

  // The caveman meme repo: a joke premise — thin, no real engineering.
  it("rejects the caveman meme repo", () => {
    const memeRepo = signals({
      stars: 30_000,
      forks: 50,
      openIssues: 1,
      sizeKb: 15,
      ageDays: 20,
      contributors: 2,
    });
    expect(qualifyRepo(memeRepo, false).ok).toBe(false);
    expect(qualifyRepo(memeRepo, true).ok).toBe(false);
  });

  // The README-marketing design tool: stars driven by a slick README, no
  // code weight, no contributor base behind it.
  it("rejects the README-marketing design tool", () => {
    const designRepo = signals({
      stars: 22_000,
      forks: 120,
      openIssues: 0,
      sizeKb: 60,
      ageDays: 45,
      contributors: 2,
    });
    expect(qualifyRepo(designRepo, false).ok).toBe(false);
    expect(qualifyRepo(designRepo, true).ok).toBe(false);
  });
});

describe("preFilterRepo (cheap, search-API-only)", () => {
  it("keeps a healthy repo", () => {
    expect(preFilterRepo(repo(1), NOW)).toBe(true);
  });

  it("drops archived/disabled/too-new/thin/no-issue/low-fork repos", () => {
    expect(preFilterRepo(repo(1, { archived: true }), NOW)).toBe(false);
    expect(preFilterRepo(repo(1, { disabled: true }), NOW)).toBe(false);
    expect(
      preFilterRepo(repo(1, { created_at: "2026-05-25T00:00:00Z" }), NOW),
    ).toBe(false); // 5 days old
    expect(preFilterRepo(repo(1, { size: 10 }), NOW)).toBe(false);
    expect(preFilterRepo(repo(1, { open_issues_count: 0 }), NOW)).toBe(false);
    expect(
      preFilterRepo(repo(1, { stargazers_count: 100_000, forks_count: 50 }), NOW),
    ).toBe(false);
  });

  it("uses lenient thresholds so a corroboration-eligible repo survives pre-filter", () => {
    // 40 days old, 5 contributors-worth-of-signal — would fail STRICT in
    // qualifyRepo but must pass the lenient pre-filter so corroboration
    // gets a chance to ease it.
    expect(
      preFilterRepo(repo(1, { created_at: "2026-04-20T00:00:00Z" }), NOW),
    ).toBe(true);
  });
});

describe("signalsFromRepo", () => {
  it("maps a search row + contributor count into the gate's signal shape", () => {
    const s = signalsFromRepo(repo(1, { stargazers_count: 4000 }), 12, NOW);
    expect(s).toMatchObject({
      stars: 4000,
      forks: 400,
      openIssues: 50,
      sizeKb: 5000,
      contributors: 12,
      archived: false,
      disabled: false,
    });
    expect(s.ageDays).toBeGreaterThan(260);
  });
});

describe("DEFAULT_QUALIFY_CONFIG", () => {
  it("keeps strict thresholds at least as demanding as lenient", () => {
    const c = DEFAULT_QUALIFY_CONFIG;
    expect(c.strictMinForkStarRatio).toBeGreaterThanOrEqual(c.minForkStarRatio);
    expect(c.strictMinRepoSizeKb).toBeGreaterThanOrEqual(c.minRepoSizeKb);
    expect(c.strictMinContributors).toBeGreaterThanOrEqual(c.minContributors);
    expect(c.strictMinRepoAgeDays).toBeGreaterThanOrEqual(c.minRepoAgeDays);
  });
});

describe("createGithubTrendingGenerator — end-to-end with the gate", () => {
  const post: GithubNativeOutput = {
    headline: "A real headline about the repo",
    body: "x".repeat(300),
  };

  it("emits a candidate for a repo that clears the gate", async () => {
    const gen = createGithubTrendingGenerator({
      fetchSearch: async () => [repo(1)],
      fetchContributorCount: async () => 20,
      corroborate: async () => true,
      authorPost: async () => post,
    });
    const candidates = await gen.generate({ now: () => NOW });
    expect(candidates.length).toBe(1);
    expect(candidates[0]!.externalId).toBe("github:1");
    expect(candidates[0]!.sector).toBe("ai");
    expect(candidates[0]!.rawPayload).toMatchObject({
      repo_id: 1,
      contributors: 20,
      corroborated: true,
      generator: "github-trending-native",
    });
  });

  it("rejects a gamed repo before it ever reaches the prompt", async () => {
    const authorPost = jest.fn(async () => post);
    const gen = createGithubTrendingGenerator({
      // 198K stars, ~zero forks, single contributor, young.
      fetchSearch: async () => [
        repo(9, {
          stargazers_count: 198_000,
          forks_count: 35,
          open_issues_count: 2,
          size: 800,
          created_at: "2026-01-10T00:00:00Z",
        }),
      ],
      fetchContributorCount: async () => 1,
      corroborate: async () => false,
      authorPost: authorPost as never,
    });
    const candidates = await gen.generate({ now: () => NOW });
    expect(candidates).toEqual([]);
    // Critically: authoring (the LLM call) is never reached for junk.
    expect(authorPost).not.toHaveBeenCalled();
  });

  it("rejects an uncorroborated repo that only clears the lenient bar", async () => {
    const authorPost = jest.fn(async () => post);
    const gen = createGithubTrendingGenerator({
      // 45 days old, 4 contributors: passes lenient, fails strict.
      fetchSearch: async () => [repo(3, { created_at: "2026-04-15T00:00:00Z" })],
      fetchContributorCount: async () => 4,
      corroborate: async () => false,
      authorPost: authorPost as never,
    });
    const candidates = await gen.generate({ now: () => NOW });
    expect(candidates).toEqual([]);
    expect(authorPost).not.toHaveBeenCalled();
  });

  it("admits that same lenient-bar repo once HN corroborates it", async () => {
    const gen = createGithubTrendingGenerator({
      fetchSearch: async () => [repo(3, { created_at: "2026-04-15T00:00:00Z" })],
      fetchContributorCount: async () => 4,
      corroborate: async () => true,
      authorPost: async () => post,
    });
    const candidates = await gen.generate({ now: () => NOW });
    expect(candidates.length).toBe(1);
    expect(candidates[0]!.rawPayload).toMatchObject({ corroborated: true });
  });

  it("ranks corroborated repos ahead of uncorroborated ones", async () => {
    const gen = createGithubTrendingGenerator({
      fetchSearch: async () => [
        // higher stars, uncorroborated — forks scaled to clear the strict
        // fork-ratio bar so it survives the gate and only LOSES on rank.
        repo(1, { stargazers_count: 9000, forks_count: 900 }),
        repo(2, { stargazers_count: 4000 }), // lower stars, corroborated
      ],
      fetchContributorCount: async () => 20,
      corroborate: async (fullName) => fullName === "owner/repo-2",
      authorPost: async () => post,
    });
    const candidates = await gen.generate({ now: () => NOW });
    expect(candidates.map((c) => c.externalId)).toEqual([
      "github:2",
      "github:1",
    ]);
  });

  it("returns an empty run when nothing clears the gate (a correct outcome)", async () => {
    const gen = createGithubTrendingGenerator({
      fetchSearch: async () => [
        repo(1, { stargazers_count: 50_000, forks_count: 10, size: 12 }),
        repo(2, { open_issues_count: 0, size: 8 }),
      ],
      fetchContributorCount: async () => 1,
      corroborate: async () => false,
      authorPost: async () => post,
    });
    const candidates = await gen.generate({ now: () => NOW });
    expect(candidates).toEqual([]);
  });

  it("skips a repo whose authoring step returns null (LLM decline or parse failure)", async () => {
    const gen = createGithubTrendingGenerator({
      fetchSearch: async () => [repo(1), repo(2)],
      fetchContributorCount: async () => 20,
      corroborate: async () => true,
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
        return [repo(1)];
      },
      fetchContributorCount: async () => 20,
      corroborate: async () => true,
      authorPost: async () => post,
    });
    const candidates = await gen.generate({ now: () => NOW });
    expect(candidates.length).toBe(1);
  });

  it("bounds extra calls to MAX_FINALISTS regardless of search volume", async () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      repo(i + 1, { stargazers_count: 10_000 - i }),
    );
    let contributorCalls = 0;
    const gen = createGithubTrendingGenerator({
      fetchSearch: async () => many,
      fetchContributorCount: async () => {
        contributorCalls += 1;
        return 20;
      },
      corroborate: async () => true,
      authorPost: async () => post,
    });
    await gen.generate({ now: () => NOW });
    expect(contributorCalls).toBe(MAX_FINALISTS);
  });

  it("caps authored candidates at MAX_NATIVE_POSTS_PER_RUN", async () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      repo(i + 1, { stargazers_count: 10_000 - i }),
    );
    const gen = createGithubTrendingGenerator({
      fetchSearch: async () => many,
      fetchContributorCount: async () => 20,
      corroborate: async () => true,
      authorPost: async () => post,
    });
    const candidates = await gen.generate({ now: () => NOW });
    expect(candidates.length).toBe(MAX_NATIVE_POSTS_PER_RUN);
  });

  it("has the expected registry slug", () => {
    expect(createGithubTrendingGenerator().slug).toBe("github-trending-native");
  });
});
