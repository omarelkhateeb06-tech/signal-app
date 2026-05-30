// Phase 12n.2 (discovery-flip) — HN-surfaced repo native generator.
//
// AUTHORS native posts about GitHub repositories the Hacker News community
// recently surfaced. This replaces the prior star-based generator
// (githubTrending.ts), whose selection was architecturally broken: ranking
// GitHub repos by stars/velocity surfaces all-time giants (no current
// story) or bot-gamed repos (fraud), and left the LLM to catch both by
// refusing to write.
//
// Root cause of that failure: GitHub stars are a LAGGING indicator of
// discovery. Discovery actually happens in human channels first — the HN
// front page — and stars follow. So we flip the architecture:
//
//   DISCOVER  from repos that recently surfaced on Hacker News (a channel
//             SIGNAL already ingests). HN votes + comments are real human
//             vetting — the anti-gaming signal no structural check matches.
//   ENRICH    each discovered repo with GitHub API metadata (stars, forks,
//             contributors, language, issues, age). Stars become supporting
//             detail, NOT the selector.
//   GATE      a simplified substance gate as a safety net (issues-to-stars,
//             fork ratio, absolute floors). No star-velocity floor — HN
//             vetting replaced it.
//   AUTHOR    hand metadata + the HN signal to Haiku for an original
//             editorial paragraph.
//
// Discovery pool = the REJECTED HN candidates (llm_rejected /
// heuristic_filtered). These are repos HN voted up that SIGNAL's
// news-relevance gate declined — "a cool tool", not "a news story". That
// gap (community-loved repo, no SIGNAL story yet) is exactly what a native
// editorial post fills. Published HN candidates already became an ingested
// event for the same repo, so re-posting them would duplicate coverage.
//
// Slug stays `github-trending-native` — the seeded source row (migration
// 0037) and CLI default are keyed on it; the architecture changed, the
// source identity did not.
//
// Legality: we read only the public repo API GitHub exposes for
// programmatic use. No HTML scraping, no repo prose reproduced. The post is
// our own editorial take on a public signal.

import {
  buildHnRepoNativePrompt,
  HN_REPO_NATIVE_ASSISTANT_PREFILL,
  HN_REPO_NATIVE_MAX_TOKENS,
  type HnRepoNativeInputs,
} from "../../../llm/prompts/ingestion/hnRepoPrompt";
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
// these compete for feed slots with curated stories.
export const MAX_NATIVE_POSTS_PER_RUN = 3;

// How far back to look for HN-surfaced repos. A repo trending on HN today
// is the current story; older HN slots are stale by native-post standards.
export const DISCOVERY_WINDOW_HOURS = 72;

// Cap on repos that reach the GitHub-enrichment stage (one repo fetch + one
// contributor-count call each). Discovery is ordered by HN score, so this
// bounds the API calls to the top HN signals per run.
export const MAX_ENRICH = 8;

// Recently-published native events are deduped against this window so we
// don't re-post a repo we already covered.
export const NATIVE_DEDUP_WINDOW_DAYS = 7;

// HN candidate statuses that define the discovery pool. The REJECTED pool:
// repos HN surfaced that SIGNAL's news-relevance gate declined. See the
// file header for why this is the right pool (coverage gap, no collision
// with already-ingested events).
export const DISCOVERY_STATUSES = ["llm_rejected", "heuristic_filtered"] as const;

// ---- Qualification gate config (tunable) ----
//
// Simplified single-threshold gate. Every threshold is a knob; a repo must
// clear EVERY floor (the bar is combined). There is no lenient/strict split
// anymore — every repo here is HN-vetted by construction, so the prior
// "uncorroborated → stricter bar" axis collapsed. The gate is now purely a
// substance safety net catching the residual gamed-star profile HN missed.
//
// Rationale for each floor:
//   - fork/star ratio: organic adoption forks; bots buy stars but don't
//     fork. A high-star repo with near-zero forks is a tell.
//   - issues-per-1k-stars: a RELATIVE credibility signal. Real usage
//     generates real bug reports. High stars + anomalously few issues is a
//     tell the stars don't reflect usage.
//   - open issues (absolute): a genuinely-used project accumulates issues;
//     zero issue activity is a tell.
//   - repo size (KB): a star-explosion around an empty repo (meme /
//     README-marketing pages) is a tell. Real projects carry code weight.
//   - age (days): brand-new repo + star explosion is the classic
//     manipulation profile.
//   - contributors: 1–2 accounts driving a "viral" repo is a tell.
export interface QualifyConfig {
  minForkStarRatio: number;
  minRepoSizeKb: number;
  minContributors: number;
  minOpenIssues: number;
  minIssuesPer1kStars: number;
  minRepoAgeDays: number;
}

export const DEFAULT_QUALIFY_CONFIG: QualifyConfig = {
  minForkStarRatio: 0.02,
  minRepoSizeKb: 100,
  minContributors: 3,
  minOpenIssues: 3,
  minIssuesPer1kStars: 1.0,
  minRepoAgeDays: 30,
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
  size: number; // repo size in KB
  language: string | null;
  topics?: string[];
  created_at: string;
  pushed_at: string;
  archived: boolean;
  disabled: boolean;
}

// ---- Model output contract ----

// `.strict()` rejects extra keys; length floors keep a degenerate one-word
// body from becoming a post.
const HnRepoNativeOutputSchema = z
  .object({
    headline: z.string().min(8).max(200),
    body: z.string().min(200).max(2400),
  })
  .strict();

export type HnRepoNativeOutput = z.infer<typeof HnRepoNativeOutputSchema>;

// Outcome of the authoring stage for one gate-passing repo. The runner
// turns "authored" into a NativeCandidate and drops the rest; the verbose
// diagnostics surface WHY a repo that cleared the gate produced no post —
// almost always the model declining ("skipped"), which is a correct
// outcome, not a bug.
export type AuthorOutcome =
  | { status: "authored"; output: HnRepoNativeOutput }
  | { status: "skipped"; reason: string } // model returned {skip:true}
  | { status: "error"; reason: string }; // call/parse/schema failure

// ---- Discovery shapes ----

// One repo URL surfaced on HN within the window, pre-enrichment. Carries
// the HN social signal that selected it.
export interface DiscoveredRepo {
  owner: string;
  repo: string;
  fullName: string; // `${owner}/${repo}`, preserving case for the API call
  hnScore: number;
  hnComments: number;
  hnUrl: string; // the original HN-submitted github.com URL
}

// One raw HN discovery row, before URL parsing. Shape the discover dep
// returns — mirrors the SELECT columns.
export interface HnDiscoveryRow {
  url: string;
  hnScore: number;
  hnComments: number;
}

// ---- Pure helpers (exported for tests) ----

export function ageDaysOf(createdAt: string, now: Date): number {
  return (now.getTime() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24);
}

// github.com paths that are NOT a user/org repo. An owner segment matching
// one of these is a product/marketing/route path, never a repo.
const RESERVED_OWNERS = new Set([
  "about",
  "collections",
  "explore",
  "features",
  "join",
  "login",
  "marketplace",
  "new",
  "notifications",
  "organizations",
  "orgs",
  "pricing",
  "pulls",
  "issues",
  "search",
  "settings",
  "sponsors",
  "topics",
  "trending",
  "users",
  "watching",
]);

// Extract {owner, repo} from a github.com URL, or null when the URL is not
// a repo. Handles deep links (issue / blob / tree URLs all resolve to their
// owner/repo) by taking the first two path segments. Rejects non-github.com
// hosts (gist.*, raw.githubusercontent.com), owner-only paths, and reserved
// product paths. Strips a trailing `.git`.
export function parseRepoFromUrl(
  raw: string,
): { owner: string; repo: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== "github.com" && host !== "www.github.com") return null;

  const segments = parsed.pathname.split("/").filter((s) => s.length > 0);
  if (segments.length < 2) return null; // owner-only or root

  const owner = segments[0]!;
  let repo = segments[1]!;
  if (repo.toLowerCase().endsWith(".git")) repo = repo.slice(0, -4);

  if (RESERVED_OWNERS.has(owner.toLowerCase())) return null;
  if (owner.length === 0 || repo.length === 0) return null;
  return { owner, repo };
}

// Lowercased dedup key for an owner/repo pair (github identity is
// case-insensitive).
export function repoKey(owner: string, repo: string): string {
  return `${owner.toLowerCase()}/${repo.toLowerCase()}`;
}

// The substance signals the gate weighs. Pure data — assembled from the
// repo fetch plus the one contributor-count call.
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

function signalsFromRepo(
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

// The gate. A repo must clear EVERY floor — the bar is combined. Returns the
// FIRST failing reason so callers (and tests) see exactly why a repo was
// rejected.
export function qualifyRepo(
  signals: RepoSignals,
  config: QualifyConfig = DEFAULT_QUALIFY_CONFIG,
): QualifyResult {
  if (signals.archived) return { ok: false, reason: "archived" };
  if (signals.disabled) return { ok: false, reason: "disabled" };
  if (signals.ageDays < config.minRepoAgeDays) {
    return { ok: false, reason: "too_new" };
  }
  if (signals.sizeKb < config.minRepoSizeKb) {
    return { ok: false, reason: "too_thin" };
  }
  if (signals.openIssues < config.minOpenIssues) {
    return { ok: false, reason: "no_issue_activity" };
  }
  const issuesPer1k =
    signals.stars > 0 ? (signals.openIssues / signals.stars) * 1000 : 0;
  if (issuesPer1k < config.minIssuesPer1kStars) {
    return { ok: false, reason: "low_issue_star_ratio" };
  }
  const forkRatio = signals.stars > 0 ? signals.forks / signals.stars : 0;
  if (forkRatio < config.minForkStarRatio) {
    return { ok: false, reason: "low_fork_star_ratio" };
  }
  if (signals.contributors < config.minContributors) {
    return { ok: false, reason: "too_few_contributors" };
  }
  return { ok: true, reason: null };
}

// Render a "value vs threshold" string for a single rejection reason, for
// human-readable dry-run diagnostics. Diagnostics-only — never consulted by
// the gate.
export function explainFloor(
  reason: string,
  signals: Pick<
    RepoSignals,
    "stars" | "forks" | "openIssues" | "sizeKb" | "ageDays" | "contributors"
  >,
  config: QualifyConfig = DEFAULT_QUALIFY_CONFIG,
): string {
  switch (reason) {
    case "archived":
      return "repo is archived";
    case "disabled":
      return "repo is disabled";
    case "too_new":
      return `age ${signals.ageDays.toFixed(0)}d < ${config.minRepoAgeDays}d`;
    case "too_thin":
      return `size ${signals.sizeKb}KB < ${config.minRepoSizeKb}KB`;
    case "no_issue_activity":
      return `open_issues ${signals.openIssues} < ${config.minOpenIssues}`;
    case "low_issue_star_ratio": {
      const ratio =
        signals.stars > 0 ? (signals.openIssues / signals.stars) * 1000 : 0;
      return `issues/1k-stars ${ratio.toFixed(2)} < ${config.minIssuesPer1kStars}`;
    }
    case "low_fork_star_ratio": {
      const ratio = signals.stars > 0 ? signals.forks / signals.stars : 0;
      return `fork/star ${ratio.toFixed(4)} < ${config.minForkStarRatio}`;
    }
    case "too_few_contributors":
      return `contributors ${signals.contributors} < ${config.minContributors}`;
    default:
      return reason;
  }
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

export interface HnRepoDiscoveryDeps {
  // Query the SIGNAL DB for HN-surfaced github.com URLs in the window.
  // Tests inject canned rows; production reads ingestion_candidates.
  discover?: (now: Date) => Promise<HnDiscoveryRow[]>;
  // Recently-published native event primary_source_urls, for dedup. Tests
  // inject canned URLs; production reads the events table.
  recentNativeUrls?: (now: Date) => Promise<string[]>;
  // Enrich one repo with GitHub metadata. Null when the repo 404s / is gone.
  fetchRepo?: (owner: string, repo: string) => Promise<GithubRepo | null>;
  // One extra call per enriched repo: resolve the real contributor count.
  fetchContributorCount?: (fullName: string) => Promise<number>;
  // Haiku client deps, forwarded to callHaikuForCommentary.
  haiku?: HaikuClientDeps;
  // Override the post-authoring step — tests bypass the LLM entirely.
  authorPost?: (
    inputs: HnRepoNativeInputs,
    haiku?: HaikuClientDeps,
  ) => Promise<AuthorOutcome>;
}

// Discover HN-surfaced github.com repos in the window from the REJECTED
// pool. Fail-CLOSED: any DB error returns []. Lazy-imports the db so the
// pure helpers above stay import-light and test-friendly.
async function defaultDiscover(now: Date): Promise<HnDiscoveryRow[]> {
  try {
    const [{ db }, schema, drizzle] = await Promise.all([
      import("../../../db"),
      import("../../../db/schema"),
      import("drizzle-orm"),
    ]);
    const { ingestionCandidates, ingestionSources } = schema;
    const { and, eq, gt, inArray, sql } = drizzle;
    const since = new Date(now.getTime() - DISCOVERY_WINDOW_HOURS * 3600 * 1000);
    const rows = await db
      .select({
        url: ingestionCandidates.url,
        score: sql<string | null>`${ingestionCandidates.rawPayload}->>'score'`,
        comments: sql<string | null>`${ingestionCandidates.rawPayload}->>'descendants'`,
      })
      .from(ingestionCandidates)
      .innerJoin(
        ingestionSources,
        eq(ingestionCandidates.ingestionSourceId, ingestionSources.id),
      )
      .where(
        and(
          eq(ingestionSources.adapterType, "hackernews_api"),
          sql`${ingestionCandidates.url} ILIKE '%github.com%'`,
          gt(ingestionCandidates.discoveredAt, since),
          inArray(ingestionCandidates.status, [...DISCOVERY_STATUSES]),
        ),
      );
    return rows.map((r) => ({
      url: r.url,
      hnScore: r.score ? parseInt(r.score, 10) || 0 : 0,
      hnComments: r.comments ? parseInt(r.comments, 10) || 0 : 0,
    }));
  } catch {
    return [];
  }
}

// Recently-published native event primary_source_urls, for dedup. Fail-
// CLOSED: any DB error returns [] (no dedup → we may re-post, but the
// per-source unique constraint on ingestion_candidates still prevents a
// duplicate row, and a stale re-post is less bad than skipping a run).
async function defaultRecentNativeUrls(now: Date): Promise<string[]> {
  try {
    const [{ db }, schema, drizzle] = await Promise.all([
      import("../../../db"),
      import("../../../db/schema"),
      import("drizzle-orm"),
    ]);
    const { events } = schema;
    const { and, eq, gt } = drizzle;
    const since = new Date(
      now.getTime() - NATIVE_DEDUP_WINDOW_DAYS * 24 * 3600 * 1000,
    );
    const rows = await db
      .select({ url: events.primarySourceUrl })
      .from(events)
      .where(and(eq(events.sourceType, "native"), gt(events.createdAt, since)));
    return rows.map((r) => r.url).filter((u): u is string => Boolean(u));
  } catch {
    return [];
  }
}

// Enrich one repo via GET /repos/{owner}/{repo}. Returns null on 404 (gone /
// renamed / private) or any error — a repo we can't verify never becomes a
// candidate.
async function defaultFetchRepo(
  owner: string,
  repo: string,
): Promise<GithubRepo | null> {
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await fetch(url, { headers: githubHeaders(), signal: ctrl.signal });
    } catch (err) {
      throw new Error(classifyFetchError(err));
    }
    if (res.status === 404) return null;
    if (res.status >= 400) return null;
    const json = (await res.json()) as GithubRepo;
    return json && typeof json.id === "number" ? json : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Resolve contributor count via a single 1-per-page call + Link-header
// pagination math. Fail-CLOSED: any error returns 0, which fails the
// contributor floor in qualifyRepo.
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
    const json = (await res.json()) as unknown;
    return Array.isArray(json) ? json.length : 0;
  } finally {
    clearTimeout(timer);
  }
}

// Author one native post from repo metadata + HN signal. Returns a
// classified outcome: "authored" on a valid post, "skipped" when the model
// declines (emits `{"skip": true}`), or "error" on any LLM/parse/schema
// failure. The caller emits a post only on "authored".
async function defaultAuthorPost(
  inputs: HnRepoNativeInputs,
  haiku?: HaikuClientDeps,
): Promise<AuthorOutcome> {
  const prompt = buildHnRepoNativePrompt(inputs);
  const result = await callHaikuForCommentary(prompt, haiku, {
    assistantPrefill: HN_REPO_NATIVE_ASSISTANT_PREFILL,
    maxTokens: HN_REPO_NATIVE_MAX_TOKENS,
  });
  if (!result.ok) return { status: "error", reason: "llm_call_failed" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.text);
  } catch {
    return { status: "error", reason: "parse_error" };
  }
  if (
    parsed !== null &&
    typeof parsed === "object" &&
    (parsed as { skip?: unknown }).skip === true
  ) {
    const rawReason = (parsed as { reason?: unknown }).reason;
    const reason =
      typeof rawReason === "string" && rawReason.trim().length > 0
        ? rawReason.trim()
        : "unspecified";
    return { status: "skipped", reason };
  }
  const validated = HnRepoNativeOutputSchema.safeParse(parsed);
  return validated.success
    ? { status: "authored", output: validated.data }
    : { status: "error", reason: "schema_invalid" };
}

// Collapse raw HN rows into unique repos, keeping the highest-HN-score
// sighting of each (a repo can surface via multiple deep links). Skips rows
// whose URL doesn't parse to a repo (emits a `discover` reject when a sink
// is set). Returns repos ordered by HN score, descending.
export function collapseDiscoveries(
  rows: HnDiscoveryRow[],
  onUnparseable?: (url: string) => void,
): DiscoveredRepo[] {
  const byKey = new Map<string, DiscoveredRepo>();
  for (const row of rows) {
    const parsed = parseRepoFromUrl(row.url);
    if (!parsed) {
      onUnparseable?.(row.url);
      continue;
    }
    const key = repoKey(parsed.owner, parsed.repo);
    const existing = byKey.get(key);
    if (!existing || row.hnScore > existing.hnScore) {
      byKey.set(key, {
        owner: parsed.owner,
        repo: parsed.repo,
        fullName: `${parsed.owner}/${parsed.repo}`,
        hnScore: row.hnScore,
        hnComments: row.hnComments,
        hnUrl: row.url,
      });
    }
  }
  return [...byKey.values()].sort((a, b) => b.hnScore - a.hnScore);
}

// Build the set of repo keys already covered by a recent native event.
export function nativeDedupKeys(urls: string[]): Set<string> {
  const keys = new Set<string>();
  for (const url of urls) {
    const parsed = parseRepoFromUrl(url);
    if (parsed) keys.add(repoKey(parsed.owner, parsed.repo));
  }
  return keys;
}

export function createHnRepoDiscoveryGenerator(
  deps: HnRepoDiscoveryDeps = {},
): NativeGenerator {
  const discover = deps.discover ?? defaultDiscover;
  const recentNativeUrls = deps.recentNativeUrls ?? defaultRecentNativeUrls;
  const fetchRepo = deps.fetchRepo ?? defaultFetchRepo;
  const fetchContributorCount =
    deps.fetchContributorCount ?? defaultFetchContributorCount;
  const authorPost = deps.authorPost ?? defaultAuthorPost;

  return {
    slug: "github-trending-native",
    async generate(ctx: NativeGeneratorContext): Promise<NativeCandidate[]> {
      const now = ctx.now();
      const emit = ctx.onDiagnostic;

      // 1) DISCOVER — HN-surfaced repos in the window, collapsed to unique
      // repos by highest HN score.
      const rawRows = await discover(now);
      const discovered = collapseDiscoveries(rawRows, (url) => {
        emit?.({
          stage: "discover",
          identifier: url,
          url,
          decision: "reject",
          reason: "unparseable_url",
        });
      });

      // 2) DEDUP — drop repos already covered by a recent native event.
      const dedupKeys = nativeDedupKeys(await recentNativeUrls(now));
      const fresh: DiscoveredRepo[] = [];
      for (const d of discovered) {
        const already = dedupKeys.has(repoKey(d.owner, d.repo));
        if (!already) fresh.push(d);
        emit?.({
          stage: "discover",
          identifier: d.fullName,
          url: d.hnUrl,
          decision: already ? "reject" : "pass",
          reason: already ? "already_posted" : null,
          signals: { hn_score: d.hnScore, hn_comments: d.hnComments },
        });
      }

      // Bound the GitHub-enrichment calls to the top HN signals.
      const toEnrich = fresh.slice(0, MAX_ENRICH);

      // 3) ENRICH + GATE — fetch GitHub metadata, run the substance gate.
      const qualified: { repo: GithubRepo; discovery: DiscoveredRepo; contributors: number }[] =
        [];
      for (const d of toEnrich) {
        const repo = await fetchRepo(d.owner, d.repo);
        if (!repo) {
          emit?.({
            stage: "qualify",
            identifier: d.fullName,
            url: d.hnUrl,
            decision: "reject",
            reason: "repo_unavailable",
            signals: { hn_score: d.hnScore },
          });
          continue;
        }
        const contributors = await fetchContributorCount(repo.full_name);
        const signals = signalsFromRepo(repo, contributors, now);
        const verdict = qualifyRepo(signals);
        if (verdict.ok) {
          qualified.push({ repo, discovery: d, contributors });
        }
        if (emit) {
          const ratio = signals.stars > 0 ? signals.forks / signals.stars : 0;
          emit({
            stage: "qualify",
            identifier: repo.full_name,
            url: repo.html_url,
            decision: verdict.ok ? "pass" : "reject",
            reason: verdict.reason,
            detail: verdict.reason
              ? explainFloor(verdict.reason, signals)
              : undefined,
            signals: {
              hn_score: d.hnScore,
              hn_comments: d.hnComments,
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

      // Cap the run, prioritizing highest HN score (qualified preserves the
      // HN-score order from `toEnrich`, but sort explicitly to be safe).
      qualified.sort((a, b) => b.discovery.hnScore - a.discovery.hnScore);
      const selected = qualified.slice(0, MAX_NATIVE_POSTS_PER_RUN);

      // 4) AUTHOR — hand metadata + HN signal to Haiku.
      const candidates: NativeCandidate[] = [];
      for (const { repo, discovery, contributors } of selected) {
        const inputs: HnRepoNativeInputs = {
          fullName: repo.full_name,
          description: repo.description,
          hnScore: discovery.hnScore,
          hnComments: discovery.hnComments,
          stars: repo.stargazers_count,
          forks: repo.forks_count,
          openIssues: repo.open_issues_count,
          contributors,
          primaryLanguage: repo.language,
          topics: repo.topics ?? [],
          createdAt: repo.created_at,
          pushedAt: repo.pushed_at,
        };
        const outcome = await authorPost(inputs, deps.haiku);
        if (emit) {
          emit({
            stage: "author",
            identifier: repo.full_name,
            url: repo.html_url,
            decision: outcome.status === "authored" ? "pass" : "reject",
            reason: outcome.status === "authored" ? null : outcome.reason,
            detail:
              outcome.status === "authored"
                ? outcome.output.headline
                : `${outcome.status}: ${outcome.reason}`,
            signals: {
              hn_score: discovery.hnScore,
              hn_comments: discovery.hnComments,
              stars: repo.stargazers_count,
            },
          });
        }
        if (outcome.status !== "authored") continue;
        const post = outcome.output;

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
            hn_score: discovery.hnScore,
            hn_comments: discovery.hnComments,
            hn_url: discovery.hnUrl,
            stars: repo.stargazers_count,
            forks: repo.forks_count,
            open_issues: repo.open_issues_count,
            contributors,
            primary_language: repo.language,
            topics: repo.topics ?? [],
            created_at: repo.created_at,
            pushed_at: repo.pushed_at,
            generator: "hn-repo-discovery",
          },
        });
      }

      return candidates;
    },
  };
}

// Default instance registered in generators/index.ts.
export const hnRepoDiscoveryGenerator = createHnRepoDiscoveryGenerator();
