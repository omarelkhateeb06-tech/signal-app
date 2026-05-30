import {
  computeStarVelocity,
  ageDaysOf,
  qualifyRepo,
  preFilterRepo,
  preFilterReason,
  explainFloor,
  signalsFromRepo,
  escapeLikePattern,
  parseLastPageFromLink,
  createGithubTrendingGenerator,
  DEFAULT_QUALIFY_CONFIG,
  MAX_NATIVE_POSTS_PER_RUN,
  MAX_FINALISTS,
  type RepoSignals,
  type GithubNativeOutput,
  type AuthorOutcome,
} from "../../src/jobs/ingestion/generators/githubTrending";
import type { GeneratorDiagnostic } from "../../src/jobs/ingestion/generators/types";

const NOW = new Date("2026-05-30T00:00:00Z");

// Wrap a finished post as the "authored" outcome the generator now expects
// from authorPost (the dep returns a classified AuthorOutcome, not a bare
// post-or-null).
function authored(output: GithubNativeOutput): AuthorOutcome {
  return { status: "authored", output };
}

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
    // Issues set high enough to clear the issue/star floor so the fork-ratio
    // floor is unambiguously what trips.
    const r = qualifyRepo(
      signals({ stars: 198_000, forks: 40, openIssues: 500, contributors: 1 }),
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

  it("rejects the high-stars / near-zero-issues fraud profile on the issue/star floor", () => {
    // ECC profile: 198K stars but only 38 open issues = 0.19 per 1k stars.
    // Forks + contributors set high so the ONLY failing floor is the
    // relative issue/star ratio — proving the new check is what bites.
    const ecc = signals({
      stars: 198_000,
      forks: 20_000, // 0.10 ratio — clears the fork floor
      openIssues: 38, // clears the absolute floor (≥3) but 0.19 per 1k
      sizeKb: 5_000,
      ageDays: 300,
      contributors: 50,
    });
    expect(qualifyRepo(ecc, true)).toEqual({
      ok: false,
      reason: "low_issue_star_ratio",
    });
    expect(qualifyRepo(ecc, false)).toEqual({
      ok: false,
      reason: "low_issue_star_ratio",
    });
  });

  it("passes a healthy giant whose issues scale with its stars", () => {
    // transformers profile: 161K stars, 2,373 issues = 14.7 per 1k stars —
    // far above both the lenient (1.0) and strict (2.0) floors.
    const transformers = signals({
      stars: 161_000,
      forks: 30_000,
      openIssues: 2_373,
      sizeKb: 250_000,
      ageDays: 2_000,
      contributors: 500,
    });
    expect(qualifyRepo(transformers, true).ok).toBe(true);
    expect(qualifyRepo(transformers, false).ok).toBe(true);
  });

  it("applies the strict issue/star bar when uncorroborated", () => {
    // 1.5 issues per 1k stars clears lenient 1.0 but not strict 2.0.
    const s = signals({ stars: 100_000, forks: 20_000, openIssues: 150 });
    expect(qualifyRepo(s, true).ok).toBe(true);
    expect(qualifyRepo(s, false)).toEqual({
      ok: false,
      reason: "low_issue_star_ratio",
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
    expect(c.strictMinIssuesPer1kStars).toBeGreaterThanOrEqual(
      c.minIssuesPer1kStars,
    );
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
      authorPost: async () => authored(post),
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
    const authorPost = jest.fn(
      async (): Promise<AuthorOutcome> => authored(post),
    );
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
      authorPost,
    });
    const candidates = await gen.generate({ now: () => NOW });
    expect(candidates).toEqual([]);
    // Critically: authoring (the LLM call) is never reached for junk.
    expect(authorPost).not.toHaveBeenCalled();
  });

  it("rejects an uncorroborated repo that only clears the lenient bar", async () => {
    const authorPost = jest.fn(
      async (): Promise<AuthorOutcome> => authored(post),
    );
    const gen = createGithubTrendingGenerator({
      // 45 days old, 4 contributors: passes lenient, fails strict.
      fetchSearch: async () => [repo(3, { created_at: "2026-04-15T00:00:00Z" })],
      fetchContributorCount: async () => 4,
      corroborate: async () => false,
      authorPost,
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
      authorPost: async () => authored(post),
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
      authorPost: async () => authored(post),
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
      authorPost: async () => authored(post),
    });
    const candidates = await gen.generate({ now: () => NOW });
    expect(candidates).toEqual([]);
  });

  it("skips a repo whose authoring step declines (model skip) but keeps the rest", async () => {
    const gen = createGithubTrendingGenerator({
      fetchSearch: async () => [repo(1), repo(2)],
      fetchContributorCount: async () => 20,
      corroborate: async () => true,
      authorPost: async (inputs): Promise<AuthorOutcome> =>
        inputs.fullName === "owner/repo-1"
          ? { status: "skipped", reason: "no-current-story" }
          : authored(post),
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
      authorPost: async () => authored(post),
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
      authorPost: async () => authored(post),
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
      authorPost: async () => authored(post),
    });
    const candidates = await gen.generate({ now: () => NOW });
    expect(candidates.length).toBe(MAX_NATIVE_POSTS_PER_RUN);
  });

  it("has the expected registry slug", () => {
    expect(createGithubTrendingGenerator().slug).toBe("github-trending-native");
  });
});

describe("preFilterReason (diagnostics) tracks preFilterRepo exactly", () => {
  it("returns null for a healthy repo", () => {
    expect(preFilterReason(repo(1), NOW)).toBeNull();
  });

  it("names the first failing floor", () => {
    expect(preFilterReason(repo(1, { archived: true }), NOW)).toBe("archived");
    expect(preFilterReason(repo(1, { disabled: true }), NOW)).toBe("disabled");
    expect(
      preFilterReason(repo(1, { created_at: "2026-05-25T00:00:00Z" }), NOW),
    ).toBe("too_new");
    expect(preFilterReason(repo(1, { size: 10 }), NOW)).toBe("too_thin");
    expect(preFilterReason(repo(1, { open_issues_count: 0 }), NOW)).toBe(
      "no_issue_activity",
    );
    expect(
      preFilterReason(
        repo(1, { stargazers_count: 100_000, forks_count: 50 }),
        NOW,
      ),
    ).toBe("low_fork_star_ratio");
  });

  it("its null/non-null outcome always matches preFilterRepo's boolean", () => {
    const cases = [
      repo(1),
      repo(1, { size: 10 }),
      repo(1, { archived: true }),
      repo(1, { open_issues_count: 0 }),
      repo(1, { created_at: "2026-05-29T00:00:00Z" }),
    ];
    for (const r of cases) {
      expect(preFilterRepo(r, NOW)).toBe(preFilterReason(r, NOW) === null);
    }
  });
});

describe("explainFloor renders value-vs-threshold strings", () => {
  it("names the bar-appropriate threshold for each reason", () => {
    expect(explainFloor("too_new", signals({ ageDays: 12 }), true)).toBe(
      "age 12d < 30d",
    );
    expect(explainFloor("too_new", signals({ ageDays: 12 }), false)).toBe(
      "age 12d < 90d",
    );
    expect(explainFloor("too_thin", signals({ sizeKb: 20 }), true)).toBe(
      "size 20KB < 100KB",
    );
    expect(
      explainFloor("no_issue_activity", signals({ openIssues: 0 }), true),
    ).toBe("open_issues 0 < 3");
    expect(
      explainFloor(
        "low_fork_star_ratio",
        signals({ stars: 198_000, forks: 40 }),
        true,
      ),
    ).toBe("fork/star 0.0002 < 0.02");
    expect(
      explainFloor("too_few_contributors", signals({ contributors: 2 }), false),
    ).toBe("contributors 2 < 8");
    expect(
      explainFloor(
        "low_issue_star_ratio",
        signals({ stars: 198_000, openIssues: 38 }),
        true,
      ),
    ).toBe("issues/1k-stars 0.19 < 1");
    expect(
      explainFloor(
        "low_issue_star_ratio",
        signals({ stars: 198_000, openIssues: 38 }),
        false,
      ),
    ).toBe("issues/1k-stars 0.19 < 2");
    expect(explainFloor("archived", signals(), true)).toBe("repo is archived");
  });
});

describe("createGithubTrendingGenerator — gate diagnostics", () => {
  const post: GithubNativeOutput = {
    headline: "A real headline about the repo",
    body: "x".repeat(300),
  };

  it("emits a prefilter record per considered repo and a qualify record per finalist", async () => {
    const records: GeneratorDiagnostic[] = [];
    const gen = createGithubTrendingGenerator({
      fetchSearch: async () => [
        repo(1), // healthy → passes pre-filter, reaches qualify
        repo(2, { size: 10 }), // thin → rejected at pre-filter, never qualifies
      ],
      fetchContributorCount: async () => 20,
      corroborate: async () => true,
      authorPost: async () => authored(post),
    });
    const candidates = await gen.generate({
      now: () => NOW,
      onDiagnostic: (r) => records.push(r),
    });

    const prefilter = records.filter((r) => r.stage === "prefilter");
    const qualify = records.filter((r) => r.stage === "qualify");
    expect(prefilter.length).toBe(2);
    expect(qualify.length).toBe(1); // only the pre-filter survivor

    const thin = prefilter.find((r) => r.identifier === "owner/repo-2");
    expect(thin?.decision).toBe("reject");
    expect(thin?.reason).toBe("too_thin");
    expect(thin?.detail).toContain("size 10KB");

    // Emission is observational — candidate output is unchanged.
    expect(candidates.length).toBe(1);
    expect(candidates[0]!.externalId).toBe("github:1");
  });

  it("reports the applied bar (strict when uncorroborated) on qualify records", async () => {
    const records: GeneratorDiagnostic[] = [];
    const gen = createGithubTrendingGenerator({
      fetchSearch: async () => [repo(1)],
      fetchContributorCount: async () => 20,
      corroborate: async () => false,
      authorPost: async () => authored(post),
    });
    await gen.generate({
      now: () => NOW,
      onDiagnostic: (r) => records.push(r),
    });
    const q = records.find((r) => r.stage === "qualify");
    expect(q?.signals?.bar).toBe("strict");
    expect(q?.signals?.hn_corroborated).toBe(false);
    expect(q?.signals?.contributors).toBe(20);
  });

  it("carries the rejection reason + detail for a finalist failing the strict bar", async () => {
    const records: GeneratorDiagnostic[] = [];
    const gen = createGithubTrendingGenerator({
      // Clears the lenient pre-filter (0.03 fork ratio ≥ 0.02, issues ≥ 3)
      // and the issue/star floor (250/100K = 2.5 per 1k ≥ strict 2.0), but
      // uncorroborated → strict 0.05 fork bar at qualify rejects it.
      fetchSearch: async () => [
        repo(9, {
          stargazers_count: 100_000,
          forks_count: 3_000,
          open_issues_count: 250,
          size: 800,
          created_at: "2026-01-10T00:00:00Z",
        }),
      ],
      fetchContributorCount: async () => 20,
      corroborate: async () => false,
      authorPost: async () => authored(post),
    });
    await gen.generate({
      now: () => NOW,
      onDiagnostic: (r) => records.push(r),
    });
    const q = records.find((r) => r.stage === "qualify");
    expect(q?.decision).toBe("reject");
    expect(q?.reason).toBe("low_fork_star_ratio");
    expect(q?.detail).toContain("fork/star");
  });

  it("produces identical candidates whether or not a sink is attached", async () => {
    const deps = {
      fetchSearch: async () => [repo(1), repo(2)],
      fetchContributorCount: async () => 20,
      corroborate: async () => true,
      authorPost: async () => authored(post),
    };
    const withSink = await createGithubTrendingGenerator(deps).generate({
      now: () => NOW,
      onDiagnostic: () => undefined,
    });
    const without = await createGithubTrendingGenerator(deps).generate({
      now: () => NOW,
    });
    expect(withSink.map((c) => c.externalId)).toEqual(
      without.map((c) => c.externalId),
    );
  });
});

describe("createGithubTrendingGenerator — authoring-stage diagnostics", () => {
  const post: GithubNativeOutput = {
    headline: "A real headline about the repo",
    body: "x".repeat(300),
  };

  it("emits an author record per gate-passing repo: AUTHORED carries the headline, SKIPPED carries the model reason", async () => {
    const records: GeneratorDiagnostic[] = [];
    const gen = createGithubTrendingGenerator({
      fetchSearch: async () => [repo(1), repo(2)],
      fetchContributorCount: async () => 20,
      corroborate: async () => true,
      authorPost: async (inputs): Promise<AuthorOutcome> =>
        inputs.fullName === "owner/repo-1"
          ? authored(post)
          : { status: "skipped", reason: "no-current-story" },
    });
    const candidates = await gen.generate({
      now: () => NOW,
      onDiagnostic: (r) => records.push(r),
    });

    const authorRecords = records.filter((r) => r.stage === "author");
    expect(authorRecords.length).toBe(2);

    const a1 = authorRecords.find((r) => r.identifier === "owner/repo-1");
    expect(a1?.decision).toBe("pass");
    expect(a1?.reason).toBeNull();
    expect(a1?.detail).toBe(post.headline);

    const a2 = authorRecords.find((r) => r.identifier === "owner/repo-2");
    expect(a2?.decision).toBe("reject");
    expect(a2?.reason).toBe("no-current-story");
    expect(a2?.detail).toContain("no-current-story");

    // Only the authored repo becomes a candidate.
    expect(candidates.map((c) => c.externalId)).toEqual(["github:1"]);
  });

  it("classifies an authoring error distinctly from a model skip", async () => {
    const records: GeneratorDiagnostic[] = [];
    const gen = createGithubTrendingGenerator({
      fetchSearch: async () => [repo(1)],
      fetchContributorCount: async () => 20,
      corroborate: async () => true,
      authorPost: async (): Promise<AuthorOutcome> => ({
        status: "error",
        reason: "parse_error",
      }),
    });
    const candidates = await gen.generate({
      now: () => NOW,
      onDiagnostic: (r) => records.push(r),
    });
    const a = records.find((r) => r.stage === "author");
    expect(a?.decision).toBe("reject");
    expect(a?.reason).toBe("parse_error");
    expect(candidates).toEqual([]);
  });

  it("emits no author records when nothing clears the gate", async () => {
    const records: GeneratorDiagnostic[] = [];
    const gen = createGithubTrendingGenerator({
      fetchSearch: async () => [repo(1, { size: 10 })], // rejected at pre-filter
      fetchContributorCount: async () => 20,
      corroborate: async () => true,
      authorPost: async () => authored(post),
    });
    await gen.generate({
      now: () => NOW,
      onDiagnostic: (r) => records.push(r),
    });
    expect(records.filter((r) => r.stage === "author").length).toBe(0);
  });
});
