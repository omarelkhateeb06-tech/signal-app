// GitHub repositories adapter (Phase 12R.A — Real-Time Layer).
//
// Polls GitHub's Search API directly for fresh, high-signal repos by topic —
// the reliable "a new repo that solves <problem>" signal. This is distinct
// from the HN-derived `tool-spotlight-native` / `github-trending-native`
// generators, which only surface a repo when Hacker News happens to talk about
// one (sparse, indirect). This adapter goes straight to the source.
//
// Per source `config`:
//   topics      string[] — GitHub topic qualifiers (e.g. ["llm","ai-agents"]).
//   minStars    number   — community-signal floor (default 100).
//   windowDays  number   — only repos pushed within this window (default 60).
//   maxRepos    number   — cap per poll across all topics (default 20).
//   contentType "tool"   — consumed by writeEvent, not this adapter; renders
//                          the result as the WORTH AN AFTERNOON card.
//
// One search request per topic (a handful per poll). Results are deduped by
// full_name and ranked by stars. externalId = `github:<owner>/<repo>` so a
// repo seen on a later poll dedups at the candidate row, not re-ingested.
//
// Auth: uses GITHUB_TOKEN (Bearer) when set — 5,000 req/hr vs 60 unauth. The
// few searches per poll fit the unauthenticated budget, so the token is
// optional (recommended for headroom).
//
// Failure strings (for sourcePollJob classification): timeout | network |
// http_4xx | http_5xx | parse_error.

import crypto from "node:crypto";
import type { AdapterContext, AdapterResult, Candidate } from "../types";

const FETCH_TIMEOUT_MS = 30_000;
const USER_AGENT = "SIGNAL/12R (+contact@signal.so)";
const GITHUB_SEARCH = "https://api.github.com/search/repositories";

const DEFAULT_TOPICS = ["llm", "ai-agents"];
const DEFAULT_MIN_STARS = 100;
const DEFAULT_WINDOW_DAYS = 60;
const DEFAULT_MAX_REPOS = 20;
const PER_PAGE = 15;

function sha256Truncated(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex").slice(0, 32);
}

function classifyFetchError(err: unknown): "timeout" | "network" {
  return (err as { name?: string }).name === "AbortError" ? "timeout" : "network";
}

async function fetchJson<T>(url: string): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      "User-Agent": USER_AGENT,
      Accept: "application/vnd.github+json",
    };
    const token = process.env.GITHUB_TOKEN;
    if (token) headers.Authorization = `Bearer ${token}`;

    let res: Response;
    try {
      res = await fetch(url, { headers, signal: ctrl.signal });
    } catch (err) {
      throw new Error(classifyFetchError(err));
    }
    // GitHub returns 403/429 on rate limit — classified as 4xx so the poll
    // job parks the source and backs off rather than terminal-rejecting.
    if (res.status >= 400 && res.status < 500) throw new Error("http_4xx");
    if (res.status >= 500) throw new Error("http_5xx");
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

interface GithubRepo {
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  language?: string | null;
  topics?: string[];
  pushed_at?: string;
  created_at?: string;
  owner?: { login?: string };
}

interface GithubSearchResponse {
  items?: GithubRepo[];
}

function readConfig(config: Record<string, unknown>): {
  topics: string[];
  minStars: number;
  windowDays: number;
  maxRepos: number;
} {
  const topicsRaw = config.topics;
  const topics =
    Array.isArray(topicsRaw) && topicsRaw.every((t) => typeof t === "string") && topicsRaw.length
      ? (topicsRaw as string[])
      : DEFAULT_TOPICS;
  const num = (v: unknown, d: number): number =>
    typeof v === "number" && Number.isFinite(v) ? v : d;
  return {
    topics,
    minStars: num(config.minStars, DEFAULT_MIN_STARS),
    windowDays: num(config.windowDays, DEFAULT_WINDOW_DAYS),
    maxRepos: num(config.maxRepos, DEFAULT_MAX_REPOS),
  };
}

export function buildCandidate(repo: GithubRepo): Candidate {
  const url = repo.html_url;
  const desc = (repo.description ?? "").trim();
  const title = (desc ? `${repo.full_name}: ${desc}` : repo.full_name).slice(0, 500);
  const topics = Array.isArray(repo.topics) ? repo.topics : [];

  // Compose a plain-text body from metadata so the heuristic seam can skip
  // fetching the JS-heavy repo page — the description + signals are the
  // substance fact-extraction needs.
  const bodyText =
    [
      desc,
      repo.language ? `Primary language: ${repo.language}.` : "",
      `${repo.stargazers_count} stars.`,
      topics.length ? `Topics: ${topics.join(", ")}.` : "",
    ]
      .filter(Boolean)
      .join(" ") || null;

  const publishedAt = repo.pushed_at
    ? new Date(repo.pushed_at)
    : repo.created_at
      ? new Date(repo.created_at)
      : null;

  return {
    externalId: `github:${repo.full_name}`,
    url,
    title,
    summary: desc || null,
    publishedAt,
    contentHash: sha256Truncated(`${url}\n${title}`),
    bodyText,
    rawPayload: {
      full_name: repo.full_name,
      html_url: url,
      description: repo.description,
      stargazers_count: repo.stargazers_count,
      language: repo.language,
      topics,
      pushed_at: repo.pushed_at ?? null,
      created_at: repo.created_at ?? null,
      owner: repo.owner?.login ?? null,
    },
  };
}

export async function githubAdapter(ctx: AdapterContext): Promise<AdapterResult> {
  const { topics, minStars, windowDays, maxRepos } = readConfig(ctx.config ?? {});
  const since = new Date(Date.now() - windowDays * 86_400_000)
    .toISOString()
    .slice(0, 10); // YYYY-MM-DD

  const byFullName = new Map<string, GithubRepo>();
  for (const topic of topics) {
    const q = `topic:${topic} pushed:>=${since} stars:>=${minStars}`;
    const url = `${GITHUB_SEARCH}?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=${PER_PAGE}`;
    const data = await fetchJson<GithubSearchResponse>(url);
    if (!data || typeof data !== "object") throw new Error("parse_error");
    for (const repo of data.items ?? []) {
      if (repo?.full_name && !byFullName.has(repo.full_name)) {
        byFullName.set(repo.full_name, repo);
      }
    }
  }

  const repos = [...byFullName.values()]
    .sort((a, b) => b.stargazers_count - a.stargazers_count)
    .slice(0, maxRepos);

  return { candidates: repos.map(buildCandidate) };
}
