import {
  ageDaysOf,
  qualifyRepo,
  explainFloor,
  parseRepoFromUrl,
  repoKey,
  parseLastPageFromLink,
  collapseDiscoveries,
  nativeDedupKeys,
  createHnRepoDiscoveryGenerator,
  DEFAULT_QUALIFY_CONFIG,
  DISCOVERY_STATUSES,
  MAX_NATIVE_POSTS_PER_RUN,
  MAX_ENRICH,
  type RepoSignals,
  type HnRepoNativeOutput,
  type AuthorOutcome,
  type HnDiscoveryRow,
} from "../../src/jobs/ingestion/generators/hnRepoDiscovery";
import type { GeneratorDiagnostic } from "../../src/jobs/ingestion/generators/types";

const NOW = new Date("2026-05-30T00:00:00Z");

const post: HnRepoNativeOutput = {
  headline: "A real headline about the repo",
  body: "x".repeat(300),
};

function authored(output: HnRepoNativeOutput): AuthorOutcome {
  return { status: "authored", output };
}

// A repo fixture shaped like the GitHub repo API subset the generator reads
// after enrichment. Defaults describe a HEALTHY, qualifying repo: old
// enough, real code weight, organic fork ratio, issue activity. Individual
// tests override fields to model the gamed/junk profiles.
function ghRepo(
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

// Build a fetchRepo from a {repoKey -> GithubRepo | null} map. A key mapped
// to null models a 404/unavailable repo; a missing key returns a default
// healthy repo so happy-path tests stay terse.
function mkFetchRepo(
  map: Record<string, any> = {},
): (owner: string, repo: string) => Promise<any> {
  return async (owner: string, repo: string) => {
    const k = repoKey(owner, repo);
    if (k in map) return map[k];
    return ghRepo(1, { full_name: `${owner}/${repo}`, html_url: `https://github.com/${owner}/${repo}` });
  };
}

const hnRow = (url: string, score: number, comments = 0): HnDiscoveryRow => ({
  url,
  hnScore: score,
  hnComments: comments,
});

describe("ageDaysOf", () => {
  it("computes whole-day age from an ISO creation date", () => {
    expect(ageDaysOf("2026-05-20T00:00:00Z", NOW)).toBeCloseTo(10, 5);
  });
});

describe("parseRepoFromUrl", () => {
  it("parses a repo-root URL", () => {
    expect(parseRepoFromUrl("https://github.com/openai/whisper")).toEqual({
      owner: "openai",
      repo: "whisper",
    });
  });

  it("parses deep links (issue / blob / tree) to their owner/repo", () => {
    expect(
      parseRepoFromUrl("https://github.com/golang/go/issues/77273"),
    ).toEqual({ owner: "golang", repo: "go" });
    expect(
      parseRepoFromUrl(
        "https://github.com/BurntSushi/ripgrep/blob/master/AI_POLICY.md",
      ),
    ).toEqual({ owner: "BurntSushi", repo: "ripgrep" });
  });

  it("strips a trailing .git", () => {
    expect(parseRepoFromUrl("https://github.com/owner/repo.git")).toEqual({
      owner: "owner",
      repo: "repo",
    });
  });

  it("accepts www.github.com", () => {
    expect(parseRepoFromUrl("https://www.github.com/a/b")).toEqual({
      owner: "a",
      repo: "b",
    });
  });

  it("rejects non-github hosts (gist, raw)", () => {
    expect(parseRepoFromUrl("https://gist.github.com/a/b")).toBeNull();
    expect(
      parseRepoFromUrl("https://raw.githubusercontent.com/a/b/main/x"),
    ).toBeNull();
  });

  it("rejects owner-only and reserved product paths", () => {
    expect(parseRepoFromUrl("https://github.com/openai")).toBeNull();
    expect(parseRepoFromUrl("https://github.com/features/copilot")).toBeNull();
    expect(parseRepoFromUrl("https://github.com/sponsors/x")).toBeNull();
    expect(parseRepoFromUrl("https://github.com/")).toBeNull();
  });

  it("rejects malformed URLs", () => {
    expect(parseRepoFromUrl("not a url")).toBeNull();
  });
});

describe("repoKey", () => {
  it("lowercases owner/repo for case-insensitive identity", () => {
    expect(repoKey("BurntSushi", "RipGrep")).toBe("burntsushi/ripgrep");
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

describe("collapseDiscoveries", () => {
  it("collapses multiple links to the same repo, keeping the highest HN score", () => {
    const out = collapseDiscoveries([
      hnRow("https://github.com/golang/go/issues/1", 120, 30),
      hnRow("https://github.com/golang/go", 300, 90),
      hnRow("https://github.com/openai/whisper", 200, 40),
    ]);
    expect(out.length).toBe(2);
    const go = out.find((d) => d.fullName === "golang/go");
    expect(go?.hnScore).toBe(300);
    expect(go?.hnComments).toBe(90);
  });

  it("orders results by HN score descending", () => {
    const out = collapseDiscoveries([
      hnRow("https://github.com/a/one", 100),
      hnRow("https://github.com/b/two", 300),
      hnRow("https://github.com/c/three", 200),
    ]);
    expect(out.map((d) => d.hnScore)).toEqual([300, 200, 100]);
  });

  it("invokes the unparseable callback and skips non-repo URLs", () => {
    const bad: string[] = [];
    const out = collapseDiscoveries(
      [
        hnRow("https://github.com/openai", 100), // owner-only
        hnRow("https://github.com/a/b", 50),
      ],
      (url) => bad.push(url),
    );
    expect(out.map((d) => d.fullName)).toEqual(["a/b"]);
    expect(bad).toEqual(["https://github.com/openai"]);
  });
});

describe("nativeDedupKeys", () => {
  it("builds a lowercased repo-key set, skipping unparseable URLs", () => {
    const set = nativeDedupKeys([
      "https://github.com/OpenAI/Whisper",
      "https://example.com/not-github",
      "https://github.com/a/b/issues/3",
    ]);
    expect(set.has("openai/whisper")).toBe(true);
    expect(set.has("a/b")).toBe(true);
    expect(set.size).toBe(2);
  });
});

describe("qualifyRepo — the simplified single-threshold gate", () => {
  it("passes a healthy repo", () => {
    expect(qualifyRepo(signals()).ok).toBe(true);
  });

  it("rejects archived repos outright", () => {
    expect(qualifyRepo(signals({ archived: true }))).toEqual({
      ok: false,
      reason: "archived",
    });
  });

  it("rejects disabled repos outright", () => {
    expect(qualifyRepo(signals({ disabled: true }))).toEqual({
      ok: false,
      reason: "disabled",
    });
  });

  it("rejects a brand-new repo on age", () => {
    expect(qualifyRepo(signals({ ageDays: 12 }))).toEqual({
      ok: false,
      reason: "too_new",
    });
  });

  it("rejects a thin/empty repo on size", () => {
    expect(qualifyRepo(signals({ sizeKb: 20 }))).toEqual({
      ok: false,
      reason: "too_thin",
    });
  });

  it("rejects a repo with no issue activity", () => {
    expect(qualifyRepo(signals({ openIssues: 0 }))).toEqual({
      ok: false,
      reason: "no_issue_activity",
    });
  });

  it("rejects the high-stars / near-zero-issues fraud profile on the issue/star floor", () => {
    // ECC profile: 198K stars but only 38 open issues = 0.19 per 1k stars.
    const ecc = signals({
      stars: 198_000,
      forks: 20_000, // clears fork floor
      openIssues: 38, // clears absolute floor (≥3) but 0.19 per 1k
      sizeKb: 5_000,
      ageDays: 300,
      contributors: 50,
    });
    expect(qualifyRepo(ecc)).toEqual({
      ok: false,
      reason: "low_issue_star_ratio",
    });
  });

  it("rejects stars-without-forks (purchased-star tell)", () => {
    const r = qualifyRepo(
      signals({ stars: 198_000, forks: 40, openIssues: 500, contributors: 50 }),
    );
    expect(r).toEqual({ ok: false, reason: "low_fork_star_ratio" });
  });

  it("rejects a 1-2 contributor 'viral' repo", () => {
    expect(qualifyRepo(signals({ contributors: 2 }))).toEqual({
      ok: false,
      reason: "too_few_contributors",
    });
  });

  it("passes a healthy giant whose issues scale with its stars", () => {
    const transformers = signals({
      stars: 161_000,
      forks: 30_000,
      openIssues: 2_373, // 14.7 per 1k
      sizeKb: 250_000,
      ageDays: 2_000,
      contributors: 500,
    });
    expect(qualifyRepo(transformers).ok).toBe(true);
  });
});

describe("DEFAULT_QUALIFY_CONFIG", () => {
  it("has sane positive floors", () => {
    const c = DEFAULT_QUALIFY_CONFIG;
    expect(c.minForkStarRatio).toBeGreaterThan(0);
    expect(c.minRepoSizeKb).toBeGreaterThan(0);
    expect(c.minContributors).toBeGreaterThan(0);
    expect(c.minOpenIssues).toBeGreaterThan(0);
    expect(c.minIssuesPer1kStars).toBeGreaterThan(0);
    expect(c.minRepoAgeDays).toBeGreaterThan(0);
  });
});

describe("DISCOVERY_STATUSES", () => {
  it("targets the rejected HN pool (the coverage-gap repos)", () => {
    expect([...DISCOVERY_STATUSES]).toEqual(["llm_rejected", "heuristic_filtered"]);
  });
});

describe("explainFloor renders value-vs-threshold strings", () => {
  it("names the threshold for each reason", () => {
    expect(explainFloor("too_new", signals({ ageDays: 12 }))).toBe(
      "age 12d < 30d",
    );
    expect(explainFloor("too_thin", signals({ sizeKb: 20 }))).toBe(
      "size 20KB < 100KB",
    );
    expect(explainFloor("no_issue_activity", signals({ openIssues: 0 }))).toBe(
      "open_issues 0 < 3",
    );
    expect(
      explainFloor("low_fork_star_ratio", signals({ stars: 198_000, forks: 40 })),
    ).toBe("fork/star 0.0002 < 0.02");
    expect(
      explainFloor("too_few_contributors", signals({ contributors: 2 })),
    ).toBe("contributors 2 < 3");
    expect(
      explainFloor(
        "low_issue_star_ratio",
        signals({ stars: 198_000, openIssues: 38 }),
      ),
    ).toBe("issues/1k-stars 0.19 < 1");
    expect(explainFloor("archived", signals())).toBe("repo is archived");
  });
});

describe("createHnRepoDiscoveryGenerator — end-to-end", () => {
  it("has the expected registry slug (kept from the prior version)", () => {
    expect(createHnRepoDiscoveryGenerator().slug).toBe("github-trending-native");
  });

  it("emits a candidate for an HN-surfaced repo that clears the gate, carrying HN signal", async () => {
    const gen = createHnRepoDiscoveryGenerator({
      discover: async () => [hnRow("https://github.com/owner/repo-1", 240, 80)],
      recentNativeUrls: async () => [],
      fetchRepo: mkFetchRepo({ "owner/repo-1": ghRepo(1) }),
      fetchContributorCount: async () => 20,
      authorPost: async () => authored(post),
    });
    const candidates = await gen.generate({ now: () => NOW });
    expect(candidates.length).toBe(1);
    expect(candidates[0]!.externalId).toBe("github:1");
    expect(candidates[0]!.sector).toBe("ai");
    expect(candidates[0]!.rawPayload).toMatchObject({
      repo_id: 1,
      hn_score: 240,
      hn_comments: 80,
      contributors: 20,
      generator: "hn-repo-discovery",
    });
  });

  it("dedups a repo already covered by a recent native event (no authoring)", async () => {
    const authorPost = jest.fn(async (): Promise<AuthorOutcome> => authored(post));
    const gen = createHnRepoDiscoveryGenerator({
      discover: async () => [hnRow("https://github.com/owner/repo-1", 240)],
      // Same repo via a deep link in a recent native event.
      recentNativeUrls: async () => [
        "https://github.com/owner/repo-1/issues/9",
      ],
      fetchRepo: mkFetchRepo({ "owner/repo-1": ghRepo(1) }),
      fetchContributorCount: async () => 20,
      authorPost,
    });
    const candidates = await gen.generate({ now: () => NOW });
    expect(candidates).toEqual([]);
    expect(authorPost).not.toHaveBeenCalled();
  });

  it("rejects a gamed repo before it ever reaches the prompt", async () => {
    const authorPost = jest.fn(async (): Promise<AuthorOutcome> => authored(post));
    const gen = createHnRepoDiscoveryGenerator({
      discover: async () => [hnRow("https://github.com/owner/repo-9", 500)],
      recentNativeUrls: async () => [],
      fetchRepo: mkFetchRepo({
        "owner/repo-9": ghRepo(9, {
          stargazers_count: 198_000,
          forks_count: 35,
          open_issues_count: 2,
          size: 800,
          created_at: "2026-05-01T00:00:00Z",
        }),
      }),
      fetchContributorCount: async () => 1,
      authorPost,
    });
    const candidates = await gen.generate({ now: () => NOW });
    expect(candidates).toEqual([]);
    expect(authorPost).not.toHaveBeenCalled();
  });

  it("skips a repo whose authoring step declines (model skip) but keeps the rest", async () => {
    const gen = createHnRepoDiscoveryGenerator({
      discover: async () => [
        hnRow("https://github.com/owner/repo-1", 300),
        hnRow("https://github.com/owner/repo-2", 200),
      ],
      recentNativeUrls: async () => [],
      fetchRepo: mkFetchRepo({
        "owner/repo-1": ghRepo(1),
        "owner/repo-2": ghRepo(2),
      }),
      fetchContributorCount: async () => 20,
      authorPost: async (inputs): Promise<AuthorOutcome> =>
        inputs.fullName === "owner/repo-1"
          ? { status: "skipped", reason: "no-current-story" }
          : authored(post),
    });
    const candidates = await gen.generate({ now: () => NOW });
    expect(candidates.map((c) => c.externalId)).toEqual(["github:2"]);
  });

  it("treats a 404/unavailable repo as a qualify rejection", async () => {
    const records: GeneratorDiagnostic[] = [];
    const gen = createHnRepoDiscoveryGenerator({
      discover: async () => [hnRow("https://github.com/owner/gone", 300)],
      recentNativeUrls: async () => [],
      fetchRepo: mkFetchRepo({ "owner/gone": null }),
      fetchContributorCount: async () => 20,
      authorPost: async () => authored(post),
    });
    const candidates = await gen.generate({
      now: () => NOW,
      onDiagnostic: (r) => records.push(r),
    });
    expect(candidates).toEqual([]);
    const q = records.find((r) => r.stage === "qualify");
    expect(q?.decision).toBe("reject");
    expect(q?.reason).toBe("repo_unavailable");
  });

  it("ranks by HN score and caps at MAX_NATIVE_POSTS_PER_RUN", async () => {
    const rows = Array.from({ length: 6 }, (_, i) =>
      hnRow(`https://github.com/owner/repo-${i + 1}`, 600 - i * 10),
    );
    const gen = createHnRepoDiscoveryGenerator({
      discover: async () => rows,
      recentNativeUrls: async () => [],
      fetchRepo: async (owner, repo) =>
        ghRepo(parseInt(repo.split("-")[1]!, 10), {
          full_name: `${owner}/${repo}`,
          html_url: `https://github.com/${owner}/${repo}`,
        }),
      fetchContributorCount: async () => 20,
      authorPost: async () => authored(post),
    });
    const candidates = await gen.generate({ now: () => NOW });
    expect(candidates.length).toBe(MAX_NATIVE_POSTS_PER_RUN);
    // The three highest HN scores: repo-1 (600), repo-2 (590), repo-3 (580).
    expect(candidates.map((c) => c.externalId)).toEqual([
      "github:1",
      "github:2",
      "github:3",
    ]);
  });

  it("bounds GitHub enrichment calls to MAX_ENRICH regardless of discovery volume", async () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      hnRow(`https://github.com/owner/repo-${i + 1}`, 1000 - i),
    );
    let repoCalls = 0;
    const gen = createHnRepoDiscoveryGenerator({
      discover: async () => rows,
      recentNativeUrls: async () => [],
      fetchRepo: async (owner, repo) => {
        repoCalls += 1;
        return ghRepo(parseInt(repo.split("-")[1]!, 10), {
          full_name: `${owner}/${repo}`,
        });
      },
      fetchContributorCount: async () => 20,
      authorPost: async () => authored(post),
    });
    await gen.generate({ now: () => NOW });
    expect(repoCalls).toBe(MAX_ENRICH);
  });

  it("returns an empty run when nothing clears the gate (a correct outcome)", async () => {
    const gen = createHnRepoDiscoveryGenerator({
      discover: async () => [
        hnRow("https://github.com/owner/repo-1", 300),
        hnRow("https://github.com/owner/repo-2", 200),
      ],
      recentNativeUrls: async () => [],
      fetchRepo: mkFetchRepo({
        "owner/repo-1": ghRepo(1, { size: 12, stargazers_count: 50_000, forks_count: 10 }),
        "owner/repo-2": ghRepo(2, { open_issues_count: 0, size: 8 }),
      }),
      fetchContributorCount: async () => 1,
      authorPost: async () => authored(post),
    });
    const candidates = await gen.generate({ now: () => NOW });
    expect(candidates).toEqual([]);
  });
});

describe("createHnRepoDiscoveryGenerator — diagnostics", () => {
  it("emits discover/qualify/author records across the pipeline", async () => {
    const records: GeneratorDiagnostic[] = [];
    const gen = createHnRepoDiscoveryGenerator({
      discover: async () => [
        hnRow("https://github.com/owner/repo-1", 300, 50), // clears gate → authored
        hnRow("https://github.com/owner/repo-2", 200), // thin → rejected at qualify
        hnRow("https://github.com/openai", 150), // owner-only → unparseable
      ],
      recentNativeUrls: async () => [],
      fetchRepo: mkFetchRepo({
        "owner/repo-1": ghRepo(1),
        "owner/repo-2": ghRepo(2, { size: 10 }),
      }),
      fetchContributorCount: async () => 20,
      authorPost: async () => authored(post),
    });
    const candidates = await gen.generate({
      now: () => NOW,
      onDiagnostic: (r) => records.push(r),
    });

    const discover = records.filter((r) => r.stage === "discover");
    const qualify = records.filter((r) => r.stage === "qualify");
    const author = records.filter((r) => r.stage === "author");

    // Two parseable repos (pass) + one unparseable reject.
    expect(discover.filter((r) => r.decision === "pass").length).toBe(2);
    const unparseable = discover.find((r) => r.reason === "unparseable_url");
    expect(unparseable?.identifier).toBe("https://github.com/openai");

    // Both parseable repos reach qualify; only repo-1 passes.
    expect(qualify.length).toBe(2);
    const thin = qualify.find((r) => r.identifier === "owner/repo-2");
    expect(thin?.decision).toBe("reject");
    expect(thin?.reason).toBe("too_thin");
    expect(thin?.detail).toContain("size 10KB");
    const ok = qualify.find((r) => r.identifier === "owner/repo-1");
    expect(ok?.decision).toBe("pass");
    expect(ok?.signals?.hn_score).toBe(300);

    // Only the gate-passer reaches authoring.
    expect(author.length).toBe(1);
    expect(author[0]!.decision).toBe("pass");
    expect(author[0]!.detail).toBe(post.headline);

    expect(candidates.map((c) => c.externalId)).toEqual(["github:1"]);
  });

  it("emits an already_posted discover reject for a deduped repo", async () => {
    const records: GeneratorDiagnostic[] = [];
    const gen = createHnRepoDiscoveryGenerator({
      discover: async () => [hnRow("https://github.com/owner/repo-1", 300)],
      recentNativeUrls: async () => ["https://github.com/owner/repo-1"],
      fetchRepo: mkFetchRepo({ "owner/repo-1": ghRepo(1) }),
      fetchContributorCount: async () => 20,
      authorPost: async () => authored(post),
    });
    await gen.generate({
      now: () => NOW,
      onDiagnostic: (r) => records.push(r),
    });
    const d = records.find((r) => r.stage === "discover");
    expect(d?.decision).toBe("reject");
    expect(d?.reason).toBe("already_posted");
    // Never enriched or authored.
    expect(records.some((r) => r.stage === "qualify")).toBe(false);
    expect(records.some((r) => r.stage === "author")).toBe(false);
  });

  it("classifies an authoring error distinctly from a model skip", async () => {
    const records: GeneratorDiagnostic[] = [];
    const gen = createHnRepoDiscoveryGenerator({
      discover: async () => [hnRow("https://github.com/owner/repo-1", 300)],
      recentNativeUrls: async () => [],
      fetchRepo: mkFetchRepo({ "owner/repo-1": ghRepo(1) }),
      fetchContributorCount: async () => 20,
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

  it("produces identical candidates whether or not a sink is attached", async () => {
    const deps = {
      discover: async () => [
        hnRow("https://github.com/owner/repo-1", 300),
        hnRow("https://github.com/owner/repo-2", 200),
      ],
      recentNativeUrls: async () => [],
      fetchRepo: mkFetchRepo({
        "owner/repo-1": ghRepo(1),
        "owner/repo-2": ghRepo(2),
      }),
      fetchContributorCount: async () => 20,
      authorPost: async () => authored(post),
    };
    const withSink = await createHnRepoDiscoveryGenerator(deps).generate({
      now: () => NOW,
      onDiagnostic: () => undefined,
    });
    const without = await createHnRepoDiscoveryGenerator(deps).generate({
      now: () => NOW,
    });
    expect(withSink.map((c) => c.externalId)).toEqual(
      without.map((c) => c.externalId),
    );
  });
});
