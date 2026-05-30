// Phase 12n.2 — GitHub trending native generator.
//
// AUTHORS native posts about fast-rising GitHub repositories in the AI
// space. This is synthesis, not reproduction: we query the public GitHub
// REST search API for repos gaining stars fast, compute a star-velocity
// signal from API metadata, and hand the *metadata only* (never the
// README) to Haiku to write an original editorial paragraph. The result
// is a NativeCandidate the runner persists + pushes through
// processNativeEnrichment.
//
// Legality: we read only the public search API and repo metadata GitHub
// itself exposes for programmatic use. We do not scrape the trending
// HTML page and we do not reproduce repo prose. The post is our own
// editorial take on a public signal.
//
// Fetch discipline mirrors adapters/hackerNews.ts: explicit User-Agent,
// AbortController timeout, classified failure strings. An optional
// GITHUB_TOKEN lifts the unauthenticated rate limit (10 → 30 search
// req/min) but is not required.
//
// Selection: for each AI topic in the allowlist, query repos pushed in
// the last PUSHED_WITHIN_DAYS sorted by stars; compute stars/day since
// creation; keep repos clearing STAR_VELOCITY_THRESHOLD; dedup across
// topics by repo id; cap at MAX_NATIVE_POSTS_PER_RUN.

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

// Stars-per-day floor for a repo to be worth a native post. 50/day is a
// genuinely fast riser without being so rare we never produce a post.
export const STAR_VELOCITY_THRESHOLD = 50;

// Hard cap on posts authored per run. Native volume is deliberately low —
// these compete for feed slots with curated stories. 12n.4 adds a
// cross-generator cap; this is the per-generator guard.
export const MAX_NATIVE_POSTS_PER_RUN = 3;

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

// ---- GitHub API shapes (subset we read) ----

interface GithubRepo {
  id: number;
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  language: string | null;
  topics?: string[];
  created_at: string;
  pushed_at: string;
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

// Stars per day since repo creation. A coarse velocity proxy — GitHub's
// search API doesn't expose a star timeseries, so creation-anchored
// velocity is the best signal available from metadata alone. Clamped so a
// repo created today doesn't divide-by-zero to Infinity.
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

// Dedup by repo id (a repo can match multiple topics), keep only repos
// clearing the velocity threshold, sort by velocity desc, cap the count.
export function selectTrendingRepos(
  repos: GithubRepo[],
  now: Date,
  threshold: number = STAR_VELOCITY_THRESHOLD,
  cap: number = MAX_NATIVE_POSTS_PER_RUN,
): Array<GithubRepo & { starVelocityPerDay: number }> {
  const byId = new Map<number, GithubRepo>();
  for (const repo of repos) {
    if (!byId.has(repo.id)) byId.set(repo.id, repo);
  }
  return Array.from(byId.values())
    .map((repo) => ({
      ...repo,
      starVelocityPerDay: computeStarVelocity(
        repo.stargazers_count,
        repo.created_at,
        now,
      ),
    }))
    .filter((repo) => repo.starVelocityPerDay >= threshold)
    .sort((a, b) => b.starVelocityPerDay - a.starVelocityPerDay)
    .slice(0, cap);
}

function classifyFetchError(err: unknown): "timeout" | "network" {
  return (err as { name?: string }).name === "AbortError" ? "timeout" : "network";
}

function isoNDaysAgo(now: Date, days: number): string {
  const d = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

// ---- Generator deps (injectable for tests) ----

export interface GithubTrendingDeps {
  // Override the raw fetch — tests inject canned search responses.
  fetchSearch?: (topic: string, now: Date) => Promise<GithubRepo[]>;
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

  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await fetch(url, { headers, signal: ctrl.signal });
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

// Author one native post from repo metadata. Returns null on any LLM or
// parse failure — the caller skips the repo rather than emitting a
// degenerate candidate.
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
  const validated = GithubNativeOutputSchema.safeParse(parsed);
  return validated.success ? validated.data : null;
}

export function createGithubTrendingGenerator(
  deps: GithubTrendingDeps = {},
): NativeGenerator {
  const fetchSearch = deps.fetchSearch ?? defaultFetchSearch;
  const authorPost = deps.authorPost ?? defaultAuthorPost;

  return {
    slug: "github-trending-native",
    async generate(ctx: NativeGeneratorContext): Promise<NativeCandidate[]> {
      const now = ctx.now();

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

      const selected = selectTrendingRepos(all, now);

      const candidates: NativeCandidate[] = [];
      for (const repo of selected) {
        const inputs: GithubNativeInputs = {
          fullName: repo.full_name,
          description: repo.description,
          stars: repo.stargazers_count,
          starVelocityPerDay: Math.round(repo.starVelocityPerDay),
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
            star_velocity_per_day: Math.round(repo.starVelocityPerDay),
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
