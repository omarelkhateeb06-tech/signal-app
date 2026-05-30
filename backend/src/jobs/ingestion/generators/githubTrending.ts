// Phase 12n.2 — GitHub trending native generator.
// Phase 12n.1 — multi-signal qualification gate (replaces star-count /
// star-velocity as the sole qualifier).
//
// AUTHORS native posts about genuinely-trending GitHub repositories in the
// AI space. This is synthesis, not reproduction: we query the public
// GitHub REST search API, run each candidate through an anti-gaming
// qualification gate, and hand the *metadata only* (never the README) to
// Haiku to write an original editorial paragraph. The result is a
// NativeCandidate the runner persists + pushes through
// processNativeEnrichment.
//
// Why a gate exists: star count and stars/day are both trivially gamed
// (bot-purchased stars cost cents). A naive "rank by velocity" selector
// surfaces star-manipulated junk — a brand-new repo with a star explosion,
// thin codebase, one contributor, and no fork/issue activity — and the LLM
// faithfully launders the inflated numbers into confident, authoritative
// analysis. Confident + well-written + wrong is worse than publishing
// nothing. So a repo must clear a COMBINED bar of substance signals BEFORE
// it can become a candidate, and a repo with anomalous traction that
// corroborates nowhere we already ingest (HN) faces a strictly higher bar.
//
// Legality: we read only the public search/repo API GitHub exposes for
// programmatic use. We do not scrape the trending HTML page and we do not
// reproduce repo prose. The post is our own editorial take on a public
// signal.
//
// Fetch discipline mirrors adapters/hackerNews.ts: explicit User-Agent,
// AbortController timeout, classified failure strings. An optional
// GITHUB_TOKEN lifts the unauthenticated rate limit (10 → 30 search
// req/min) but is not required. The contributor-count call is bounded to
// at most MAX_FINALISTS per run by the cheap pre-filter.

import {
  buildGithubNativePrompt,
  GITHUB_NATIVE_ASSISTANT_PREFILL,
  GITHUB_NATIVE_MAX_TOKENS,
  type GithubNativeInputs,
} from "../../../llm/prompts/ingestion/githubNative";
import {
  callHaikuForCommentary,
  type HaikuClientDeps,
} from "../../../services/haikuCommentaryClient";
import type { NativeCandidate, NativeGenerator, NativeGeneratorContext } from "./types";
import { z } from "zod";

// ---- Config ----

export const GITHUB_API_BASE = "https://api.github.com";
const FETCH_TIMEOUT_MS = 30_000;
const USER_AGENT = "SIGNAL/12n.2 (+contact@signal.so)";

// Hard cap on posts authored per run. Native volume is deliberately low —
// these compete for feed slots with curated stories. 12n.4 adds a
// cross-generator cap; this is the per-generator guard.
export const MAX_NATIVE_POSTS_PER_RUN = 3;

// Cap on repos that reach the extra-call stage (contributor count +
// corroboration). The cheap pre-filter bounds the finalist set so a run
// makes at most MAX_FINALISTS contributor-count calls regardless of how
// many repos the search returns.
export const MAX_FINALISTS = 8;

// Only consider repos pushed within this window — a repo trending today
// should be actively maintained, not a years-old project resurfacing.
export const PUSHED_WITHIN_DAYS = 14;

// Topic allowlist — the GitHub `topic:` qualifier that scopes a search to
// the AI space. Keeping this explicit (rather than a free-text query)
// makes the sector classification authoritative: every selected repo is
// AI by construction, which is why the native path can skip the relevance
// gate.
export const AI_TOPICS = [
  "llm",
  "large-language-models",
  "generative-ai",
  "ai-agents",
  "rag",
  "machine-learning",
  "deep-learning",
  "transformers",
] as const;

const SEARCH_PER_PAGE = 20;

// ---- Qualification gate config (tunable) ----
//
// Every threshold here is a knob. A repo must clear the COMBINED bar — no
// single metric qualifies a repo, and failing any floor disqualifies it.
// The `strict*` variants apply when a repo is UNCORROBORATED (no matching
// HN signal): big numbers with zero corroboration anywhere is the exact
// shape of a purchased-star repo, so we demand stronger substance signals
// before trusting it.
//
// Rationale for each floor:
//   - fork/star ratio: organic adoption forks. Gamed repos buy stars but
//     bots don't fork — a 198K-star repo with 40 forks is a tell.
//   - repo size (KB): a star-explosion around an empty/near-empty repo
//     (meme repos, README-marketing pages) is a tell. Real projects carry
//     code weight.
//   - open issues: a genuinely-used project accumulates issues. Zero issue
//     activity at high stars is a tell.
//   - age (days): brand-new repo + star explosion is the classic
//     manipulation profile. Real traction takes time to compound.
//   - contributors: 1–2 accounts driving a "viral" repo is a tell. Real
//     momentum pulls in contributors.
export interface QualifyConfig {
  minForkStarRatio: number;
  strictMinForkStarRatio: number;
  minRepoSizeKb: number;
  strictMinRepoSizeKb: number;
  minContributors: number;
  strictMinContributors: number;
  minOpenIssues: number;
  minRepoAgeDays: number;
  strictMinRepoAgeDays: number;
}

export const DEFAULT_QUALIFY_CONFIG: QualifyConfig = {
  minForkStarRatio: 0.02,
  strictMinForkStarRatio: 0.05,
  minRepoSizeKb: 100,
  strictMinRepoSizeKb: 500,
  minContributors: 3,
  strictMinContributors: 8,
  minOpenIssues: 3,
  minRepoAgeDays: 30,
  strictMinRepoAgeDays: 90,
};

// ---- GitHub API shapes (subset we read) ----

interface GithubRepo {
  id: number;
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  size: number; // repo size in KB (search API field)
  language: string | null;
  topics?: string[];
  created_at: string;
  pushed_at: string;
  archived: boolean;
  disabled: boolean;
}

interface GithubSearchResponse {
  items: GithubRepo[];
}

// Model output contract. `.strict()` rejects extra keys; length floors
// keep a degenerate one-word body from becoming a post.
const GithubNativeOutputSchema = z
  .object({
    headline: z.string().min(8).max(200),
    body: z.string().min(200).max(2400),
  })
  .strict();

export type GithubNativeOutput = z.infer<typeof GithubNativeOutputSchema>;

// ---- Pure helpers (exported for tests) ----

// Stars per day since repo creation. Kept ONLY as an informational signal
// fed to the prompt — it is NO LONGER a qualifier (it ranked gamed young
// repos first). Clamped so a repo created today doesn't divide-by-zero.
export function computeStarVelocity(
  stars: number,
  createdAt: string,
  now: Date,
): number {
  const created = new Date(createdAt).getTime();
  const ageMs = now.getTime() - created;
  const ageDays = Math.max(ageMs / (1000 * 60 * 60 * 24), 1);
  return stars / ageDays;
}

export function ageDaysOf(createdAt: string, now: Date): number {
  return (now.getTime() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24);
}

// The substance signals the gate weighs. Pure data — assembled from the
// search API row plus the one contributor-count extra call.
export interface RepoSignals {
  stars: number;
  forks: number;
  openIssues: number;
  sizeKb: number;
  ageDays: number;
  contributors: number;
  archived: boolean;
  disabled: boolean;
}

export interface QualifyResult {
  ok: boolean;
  reason: string | null;
}

export function signalsFromRepo(
  repo: GithubRepo,
  contributors: number,
  now: Date,
): RepoSignals {
  return {
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    openIssues: repo.open_issues_count,
    sizeKb: repo.size,
    ageDays: ageDaysOf(repo.created_at, now),
    contributors,
    archived: repo.archived,
    disabled: repo.disabled,
  };
}

// The gate. A repo must clear EVERY floor — the bar is combined, not any
// single metric. `corroborated` selects the lenient vs. strict thresholds
// for the gameable signals. Returns the FIRST failing reason so callers
// (and tests) can see exactly why a repo was rejected.
export function qualifyRepo(
  signals: RepoSignals,
  corroborated: boolean,
  config: QualifyConfig = DEFAULT_QUALIFY_CONFIG,
): QualifyResult {
  if (signals.archived) return { ok: false, reason: "archived" };
  if (signals.disabled) return { ok: false, reason: "disabled" };

  const minAge = corroborated
    ? config.minRepoAgeDays
    : config.strictMinRepoAgeDays;
  if (signals.ageDays < minAge) return { ok: false, reason: "too_new" };

  const minSize = corroborated
    ? config.minRepoSizeKb
    : config.strictMinRepoSizeKb;
  if (signals.sizeKb < minSize) return { ok: false, reason: "too_thin" };

  if (signals.openIssues < config.minOpenIssues) {
    return { ok: false, reason: "no_issue_activity" };
  }

  const forkRatio = signals.stars > 0 ? signals.forks / signals.stars : 0;
  const minForkRatio = corroborated
    ? config.minForkStarRatio
    : config.strictMinForkStarRatio;
  if (forkRatio < minForkRatio) {
    return { ok: false, reason: "low_fork_star_ratio" };
  }

  const minContrib = corroborated
    ? config.minContributors
    : config.strictMinContributors;
  if (signals.contributors < minContrib) {
    return { ok: false, reason: "too_few_contributors" };
  }

  return { ok: true, reason: null };
}

// Cheap pre-filter run on search-API fields ONLY (no extra calls). Its
// sole job is to bound the finalist set so we make at most MAX_FINALISTS
// contributor-count calls per run. Uses the LENIENT (corroborated)
// thresholds so a repo that could pass once corroborated is never dropped
// here — final qualification (with contributors + corroboration) happens
// in qualifyRepo. Contributor count is unknown at this stage, so it is not
// checked here.
//
// Returns the FIRST failing floor name, or null when the repo passes.
// `preFilterRepo` is the boolean view of this same decision — the two
// share one implementation so the diagnostic reason can never drift from
// the pass/fail outcome.
export function preFilterReason(
  repo: GithubRepo,
  now: Date,
  config: QualifyConfig = DEFAULT_QUALIFY_CONFIG,
): string | null {
  if (repo.archived) return "archived";
  if (repo.disabled) return "disabled";
  if (ageDaysOf(repo.created_at, now) < config.minRepoAgeDays) return "too_new";
  if (repo.size < config.minRepoSizeKb) return "too_thin";
  if (repo.open_issues_count < config.minOpenIssues) {
    return "no_issue_activity";
  }
  const forkRatio =
    repo.stargazers_count > 0 ? repo.forks_count / repo.stargazers_count : 0;
  if (forkRatio < config.minForkStarRatio) return "low_fork_star_ratio";
  return null;
}

export function preFilterRepo(
  repo: GithubRepo,
  now: Date,
  config: QualifyConfig = DEFAULT_QUALIFY_CONFIG,
): boolean {
  return preFilterReason(repo, now, config) === null;
}

// Render a "value vs threshold" string for a single rejection reason, for
// human-readable dry-run diagnostics. Diagnostics-only — never consulted
// by the gate. `corroborated` selects which threshold variant to name (the
// pre-filter stage always uses the lenient bar, so it passes
// corroborated=true).
export function explainFloor(
  reason: string,
  signals: Pick<
    RepoSignals,
    "stars" | "forks" | "openIssues" | "sizeKb" | "ageDays" | "contributors"
  >,
  corroborated: boolean,
  config: QualifyConfig = DEFAULT_QUALIFY_CONFIG,
): string {
  switch (reason) {
    case "archived":
      return "repo is archived";
    case "disabled":
      return "repo is disabled";
    case "too_new": {
      const t = corroborated
        ? config.minRepoAgeDays
        : config.strictMinRepoAgeDays;
      return `age ${signals.ageDays.toFixed(0)}d < ${t}d`;
    }
    case "too_thin": {
      const t = corroborated
        ? config.minRepoSizeKb
        : config.strictMinRepoSizeKb;
      return `size ${signals.sizeKb}KB < ${t}KB`;
    }
    case "no_issue_activity":
      return `open_issues ${signals.openIssues} < ${config.minOpenIssues}`;
    case "low_fork_star_ratio": {
      const ratio = signals.stars > 0 ? signals.forks / signals.stars : 0;
      const t = corroborated
        ? config.minForkStarRatio
        : config.strictMinForkStarRatio;
      return `fork/star ${ratio.toFixed(4)} < ${t}`;
    }
    case "too_few_contributors": {
      const t = corroborated
        ? config.minContributors
        : config.strictMinContributors;
      return `contributors ${signals.contributors} < ${t}`;
    }
    default:
      return reason;
  }
}

// Escape LIKE/ILIKE metacharacters so a repo name containing `_` or `%`
// can't widen the corroboration match. Paired with `ESCAPE '\'` in the SQL.
export function escapeLikePattern(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

// Parse the `rel="last"` page number out of a GitHub `Link` header. With
// `per_page=1` that page number equals the contributor count.
export function parseLastPageFromLink(link: string): number | null {
  for (const part of link.split(",")) {
    if (/rel="last"/.test(part)) {
      const m = part.match(/[?&]page=(\d+)/);
      if (m) return parseInt(m[1]!, 10);
    }
  }
  return null;
}

function classifyFetchError(err: unknown): "timeout" | "network" {
  return (err as { name?: string }).name === "AbortError" ? "timeout" : "network";
}

function isoNDaysAgo(now: Date, days: number): string {
  const d = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

// ---- Generator deps (injectable for tests) ----

export interface GithubTrendingDeps {
  // Override the raw search fetch — tests inject canned search responses.
  fetchSearch?: (topic: string, now: Date) => Promise<GithubRepo[]>;
  // One extra call per finalist: resolve the real contributor count.
  fetchContributorCount?: (fullName: string) => Promise<number>;
  // Does this repo corroborate against signals we already ingest (HN)?
  corroborate?: (fullName: string) => Promise<boolean>;
  // Haiku client deps, forwarded to callHaikuForCommentary.
  haiku?: HaikuClientDeps;
  // Override the post-authoring step — tests bypass the LLM entirely.
  authorPost?: (
    inputs: GithubNativeInputs,
    haiku?: HaikuClientDeps,
  ) => Promise<GithubNativeOutput | null>;
}

async function defaultFetchSearch(topic: string, now: Date): Promise<GithubRepo[]> {
  const pushedSince = isoNDaysAgo(now, PUSHED_WITHIN_DAYS);
  const query = `topic:${topic} pushed:>=${pushedSince}`;
  const url =
    `${GITHUB_API_BASE}/search/repositories` +
    `?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=${SEARCH_PER_PAGE}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await fetch(url, { headers: githubHeaders(), signal: ctrl.signal });
    } catch (err) {
      throw new Error(classifyFetchError(err));
    }
    if (res.status >= 400 && res.status < 500) throw new Error("http_4xx");
    if (res.status >= 500) throw new Error("http_5xx");
    const json = (await res.json()) as GithubSearchResponse;
    return Array.isArray(json.items) ? json.items : [];
  } finally {
    clearTimeout(timer);
  }
}

// Resolve contributor count via a single 1-per-page call + Link-header
// pagination math. Fail-CLOSED: any error returns 0, which fails the
// contributor floor in qualifyRepo (we never trust a repo whose substance
// we couldn't verify).
async function defaultFetchContributorCount(fullName: string): Promise<number> {
  const url =
    `${GITHUB_API_BASE}/repos/${fullName}/contributors?per_page=1&anon=1`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await fetch(url, { headers: githubHeaders(), signal: ctrl.signal });
    } catch {
      return 0;
    }
    if (res.status >= 400) return 0;
    const link = res.headers.get("link");
    if (link) {
      const last = parseLastPageFromLink(link);
      if (last !== null) return last;
    }
    // No `rel="last"` → at most one page; count the items directly.
    const json = (await res.json()) as unknown;
    return Array.isArray(json) ? json.length : 0;
  } finally {
    clearTimeout(timer);
  }
}

// Does a repo corroborate against signals we already ingest? Today that
// means: has Hacker News surfaced a story linking to this repo? Fail-
// CLOSED: any DB error returns false (uncorroborated), which routes the
// repo to the STRICT bar rather than silently easing it. Lazy-imports the
// db so the pure helpers above stay import-light and test-friendly.
async function defaultCorroborate(fullName: string): Promise<boolean> {
  try {
    const [{ db }, schema, drizzle] = await Promise.all([
      import("../../../db"),
      import("../../../db/schema"),
      import("drizzle-orm"),
    ]);
    const { ingestionCandidates, ingestionSources } = schema;
    const { and, eq, sql } = drizzle;
    const pattern = `%github.com/${escapeLikePattern(fullName)}%`;
    const rows = await db
      .select({ id: ingestionCandidates.id })
      .from(ingestionCandidates)
      .innerJoin(
        ingestionSources,
        eq(ingestionCandidates.ingestionSourceId, ingestionSources.id),
      )
      .where(
        and(
          eq(ingestionSources.adapterType, "hackernews_api"),
          sql`${ingestionCandidates.url} ILIKE ${pattern} ESCAPE '\\'`,
        ),
      )
      .limit(1);
    return rows.length > 0;
  } catch {
    return false;
  }
}

// Author one native post from repo metadata. Returns null on any LLM or
// parse failure, AND when the model itself declines (emits `{"skip":
// true}`) — the caller skips the repo rather than emitting a degenerate or
// manufactured candidate.
async function defaultAuthorPost(
  inputs: GithubNativeInputs,
  haiku?: HaikuClientDeps,
): Promise<GithubNativeOutput | null> {
  const prompt = buildGithubNativePrompt(inputs);
  const result = await callHaikuForCommentary(prompt, haiku, {
    assistantPrefill: GITHUB_NATIVE_ASSISTANT_PREFILL,
    maxTokens: GITHUB_NATIVE_MAX_TOKENS,
  });
  if (!result.ok) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.text);
  } catch {
    return null;
  }
  // The model is allowed to decline a repo whose traction looks anomalous
  // relative to its actual substance. A skip is a correct outcome, not a
  // failure — never force a post.
  if (
    parsed !== null &&
    typeof parsed === "object" &&
    (parsed as { skip?: unknown }).skip === true
  ) {
    return null;
  }
  const validated = GithubNativeOutputSchema.safeParse(parsed);
  return validated.success ? validated.data : null;
}

interface QualifiedFinalist {
  repo: GithubRepo;
  contributors: number;
  corroborated: boolean;
}

export function createGithubTrendingGenerator(
  deps: GithubTrendingDeps = {},
): NativeGenerator {
  const fetchSearch = deps.fetchSearch ?? defaultFetchSearch;
  const fetchContributorCount =
    deps.fetchContributorCount ?? defaultFetchContributorCount;
  const corroborate = deps.corroborate ?? defaultCorroborate;
  const authorPost = deps.authorPost ?? defaultAuthorPost;

  return {
    slug: "github-trending-native",
    async generate(ctx: NativeGeneratorContext): Promise<NativeCandidate[]> {
      const now = ctx.now();
      const emit = ctx.onDiagnostic;

      // Gather repos across every allowlisted topic. A topic-level fetch
      // failure is non-fatal — we collect what we can and let the others
      // through (one flaky topic shouldn't zero out a run).
      const all: GithubRepo[] = [];
      for (const topic of AI_TOPICS) {
        try {
          const repos = await fetchSearch(topic, now);
          all.push(...repos);
        } catch {
          // swallow per-topic failure; continue gathering
        }
      }

      // Dedup by repo id (a repo can match multiple topics).
      const byId = new Map<number, GithubRepo>();
      for (const repo of all) {
        if (!byId.has(repo.id)) byId.set(repo.id, repo);
      }

      // Cheap pre-filter on search-API fields, then rank by stars and take
      // the finalists. This bounds the contributor-count + corroboration
      // calls to at most MAX_FINALISTS per run. Diagnostics (when enabled)
      // report every considered repo and why it passed or was dropped.
      const passedPreFilter: GithubRepo[] = [];
      for (const repo of byId.values()) {
        const reason = preFilterReason(repo, now);
        if (reason === null) {
          passedPreFilter.push(repo);
        }
        if (emit) {
          const ageDays = ageDaysOf(repo.created_at, now);
          const ratio =
            repo.stargazers_count > 0
              ? repo.forks_count / repo.stargazers_count
              : 0;
          emit({
            stage: "prefilter",
            identifier: repo.full_name,
            url: repo.html_url,
            decision: reason === null ? "pass" : "reject",
            reason,
            detail:
              reason === null
                ? undefined
                : explainFloor(
                    reason,
                    {
                      stars: repo.stargazers_count,
                      forks: repo.forks_count,
                      openIssues: repo.open_issues_count,
                      sizeKb: repo.size,
                      ageDays,
                      contributors: -1, // unknown at pre-filter
                    },
                    true, // pre-filter always uses the lenient bar
                  ),
            signals: {
              stars: repo.stargazers_count,
              forks: repo.forks_count,
              fork_star_ratio: Number(ratio.toFixed(4)),
              age_days: Math.round(ageDays),
              size_kb: repo.size,
              open_issues: repo.open_issues_count,
              star_velocity: Math.round(
                computeStarVelocity(repo.stargazers_count, repo.created_at, now),
              ),
            },
          });
        }
      }

      const finalists = passedPreFilter
        .sort((a, b) => b.stargazers_count - a.stargazers_count)
        .slice(0, MAX_FINALISTS);

      // Run the full gate on each finalist (extra calls happen here).
      const qualified: QualifiedFinalist[] = [];
      for (const repo of finalists) {
        const contributors = await fetchContributorCount(repo.full_name);
        const corroborated = await corroborate(repo.full_name);
        const signals = signalsFromRepo(repo, contributors, now);
        const verdict = qualifyRepo(signals, corroborated);
        if (verdict.ok) {
          qualified.push({ repo, contributors, corroborated });
        }
        if (emit) {
          const ratio =
            signals.stars > 0 ? signals.forks / signals.stars : 0;
          emit({
            stage: "qualify",
            identifier: repo.full_name,
            url: repo.html_url,
            decision: verdict.ok ? "pass" : "reject",
            reason: verdict.reason,
            detail: verdict.reason
              ? explainFloor(verdict.reason, signals, corroborated)
              : undefined,
            signals: {
              bar: corroborated ? "lenient" : "strict",
              hn_corroborated: corroborated,
              contributors,
              stars: signals.stars,
              forks: signals.forks,
              fork_star_ratio: Number(ratio.toFixed(4)),
              age_days: Math.round(signals.ageDays),
              size_kb: signals.sizeKb,
              open_issues: signals.openIssues,
            },
          });
        }
      }

      // Rank corroborated repos first (a repo that shows up on HN is a
      // safer bet than one that doesn't), then by stars. Cap the run.
      qualified.sort((a, b) => {
        if (a.corroborated !== b.corroborated) return a.corroborated ? -1 : 1;
        return b.repo.stargazers_count - a.repo.stargazers_count;
      });
      const selected = qualified.slice(0, MAX_NATIVE_POSTS_PER_RUN);

      const candidates: NativeCandidate[] = [];
      for (const { repo, contributors, corroborated } of selected) {
        const velocity = Math.round(
          computeStarVelocity(repo.stargazers_count, repo.created_at, now),
        );
        const inputs: GithubNativeInputs = {
          fullName: repo.full_name,
          description: repo.description,
          stars: repo.stargazers_count,
          starVelocityPerDay: velocity,
          forks: repo.forks_count,
          openIssues: repo.open_issues_count,
          contributors,
          corroborated,
          primaryLanguage: repo.language,
          topics: repo.topics ?? [],
          createdAt: repo.created_at,
          pushedAt: repo.pushed_at,
        };
        const post = await authorPost(inputs, deps.haiku);
        if (!post) continue;

        candidates.push({
          externalId: `github:${repo.id}`,
          url: repo.html_url,
          headline: post.headline,
          body: post.body,
          sector: "ai",
          summary: repo.description,
          rawPayload: {
            repo_id: repo.id,
            full_name: repo.full_name,
            stars: repo.stargazers_count,
            star_velocity_per_day: velocity,
            forks: repo.forks_count,
            open_issues: repo.open_issues_count,
            contributors,
            corroborated,
            primary_language: repo.language,
            topics: repo.topics ?? [],
            created_at: repo.created_at,
            pushed_at: repo.pushed_at,
            generator: "github-trending-native",
          },
        });
      }

      return candidates;
    },
  };
}

// Default instance registered in generators/index.ts.
export const githubTrendingGenerator = createGithubTrendingGenerator();
