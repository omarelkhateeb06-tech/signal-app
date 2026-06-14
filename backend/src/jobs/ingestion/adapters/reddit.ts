// Reddit API adapter — top-of-day posts from a fixed subreddit list.
//
// Userless OAuth2 (client-credentials): POST /api/v1/access_token with the
// app's client_id:client_secret as HTTP Basic → a bearer token → GET
// oauth.reddit.com/r/<sub>/top?t=day. A fresh token per invocation (the
// AdapterFn contract is stateless; at the 4-hour poll cadence the extra token
// request is free).
//
// Like the HN adapter, both post shapes are accepted and the body seam's
// 500-char floor is what enforces substance:
//   - link posts  (is_self=false) — url points off-site; the body seam fetches
//     and extracts the linked article (long-form → clears the floor).
//   - self posts  (is_self=true)  — the selftext IS the content; it rides
//     downstream as pre-fetched bodyText (source_url = the reddit permalink,
//     which is a JS comment-page shell readability can't extract). A short
//     self-post fails the floor and is dropped — exactly the desired filter,
//     so no per-source floor exemption is needed (this is why Reddit is viable
//     where short-form social, e.g. Bluesky, is not).
//
// The LLM relevance gate assigns the ai/finance/semiconductors sector and
// rejects off-topic posts, so there is no domain/keyword allowlist here.
//
// Requires REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET. When either is unset the
// adapter logs and returns no candidates — the same graceful-degrade pattern
// as fredApi / youtubeTranscript, so the source can be enabled before the
// credentials land in Railway. Free Reddit API tier is fine for the private
// beta; commercial scale needs a contract (tracked in ROADMAP §19).
//
// Reddit fair-use: a descriptive, unique User-Agent is REQUIRED (Reddit
// 429/403s generic UAs), and OAuth is rate-limited to ~60 req/min — a handful
// of subreddits every 4h is comfortably under.
//
// Failure strings (mirrors the other adapters): timeout | network | http_4xx
// | http_5xx | parse_error

import crypto from "node:crypto";
import type { AdapterContext, AdapterResult, Candidate } from "../types";

const OAUTH_TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
const API_BASE = "https://oauth.reddit.com";
const DEFAULT_USER_AGENT = "web:signal-ingestion:v12 (by /u/signal-app)";
const FETCH_TIMEOUT_MS = 30_000;
const INTER_REQUEST_DELAY_MS = 200;

const DEFAULT_MIN_SCORE = 100;
const DEFAULT_LIMIT_PER_SUB = 25;
const DEFAULT_SUBREDDITS = ["SecurityAnalysis", "investing"];

const MAX_FETCH_ATTEMPTS = 3;
const RETRYABLE_ERRORS = new Set(["http_5xx", "timeout", "network"]);

function sha256Truncated(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex").slice(0, 32);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function classifyFetchError(err: unknown): "timeout" | "network" {
  return (err as { name?: string }).name === "AbortError" ? "timeout" : "network";
}

function pickUserAgent(config: Record<string, unknown>): string {
  const override = config.userAgent;
  return typeof override === "string" && override.length > 0 ? override : DEFAULT_USER_AGENT;
}

async function requestOnce(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal: ctrl.signal });
    } catch (err) {
      throw new Error(classifyFetchError(err));
    }
    if (res.status >= 400 && res.status < 500) throw new Error("http_4xx");
    if (res.status >= 500) throw new Error("http_5xx");
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function requestWithRetry(url: string, init: RequestInit): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt++) {
    try {
      return await requestOnce(url, init);
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!RETRYABLE_ERRORS.has(msg) || attempt === MAX_FETCH_ATTEMPTS) throw err;
      await sleep(300 * attempt); // 300ms, then 600ms
    }
  }
  throw lastErr;
}

interface TokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
}

async function getAccessToken(
  clientId: string,
  clientSecret: string,
  ua: string,
): Promise<string> {
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await requestWithRetry(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": ua,
    },
    body: "grant_type=client_credentials",
  });
  let json: TokenResponse;
  try {
    json = (await res.json()) as TokenResponse;
  } catch {
    throw new Error("parse_error");
  }
  if (!json.access_token) throw new Error("http_4xx"); // bad creds / denied
  return json.access_token;
}

// ---- Reddit listing shapes (only the fields read) ----

interface RedditPost {
  name?: string; // fullname, e.g. "t3_abc123" — the dedup key
  id?: string;
  title?: string;
  url?: string;
  permalink?: string;
  selftext?: string;
  is_self?: boolean;
  score?: number;
  created_utc?: number;
  stickied?: boolean;
  over_18?: boolean;
}

interface RedditListing {
  data?: { children?: Array<{ kind?: string; data?: RedditPost }> };
}

async function fetchSubredditTop(
  token: string,
  subreddit: string,
  ua: string,
  limit: number,
): Promise<RedditPost[]> {
  const url =
    `${API_BASE}/r/${encodeURIComponent(subreddit)}/top` +
    `?t=day&limit=${limit}&raw_json=1`;
  const res = await requestWithRetry(url, {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": ua },
  });
  let json: RedditListing;
  try {
    json = (await res.json()) as RedditListing;
  } catch {
    throw new Error("parse_error");
  }
  return (json.data?.children ?? [])
    .filter((c) => c.kind === "t3" && c.data)
    .map((c) => c.data as RedditPost);
}

function hasText(post: RedditPost): boolean {
  return typeof post.selftext === "string" && post.selftext.trim().length > 0;
}

function hasUrl(post: RedditPost): boolean {
  return typeof post.url === "string" && post.url.trim().length > 0;
}

function isUsablePost(post: RedditPost, minScore: number): boolean {
  if (!post.name || !post.title) return false;
  if (post.stickied || post.over_18) return false; // mod pins + NSFW
  if ((post.score ?? 0) < minScore) return false;
  // A self post needs body text; a link post needs an off-site url. The
  // body seam's floor then drops thin self-posts and unextractable links.
  return post.is_self ? hasText(post) : hasUrl(post);
}

function buildCandidate(post: RedditPost, subreddit: string): Candidate {
  const isSelf = Boolean(post.is_self);
  const permalinkUrl = post.permalink
    ? `https://www.reddit.com${post.permalink}`
    : `https://www.reddit.com/comments/${post.id ?? ""}`;
  const url = isSelf ? permalinkUrl : post.url!;
  const title = post.title ?? null;
  const publishedAt =
    typeof post.created_utc === "number" ? new Date(post.created_utc * 1000) : null;
  // selftext (raw_json=1) is already plain markdown text — no HTML decode
  // needed, unlike the HN self-post path.
  const bodyText = isSelf && post.selftext ? post.selftext.trim() : null;

  const rawPayload: Record<string, unknown> = {
    ...(post as unknown as Record<string, unknown>),
    subreddit,
  };
  if (isSelf) rawPayload.is_community_post = true;

  return {
    externalId: post.name!, // Reddit fullname (t3_...) — stable dedup key
    url,
    title,
    summary: null,
    publishedAt,
    contentHash: sha256Truncated(`${url}\n${title ?? ""}`),
    bodyText,
    rawPayload,
  };
}

function readSubreddits(config: Record<string, unknown>): string[] {
  const raw = config.subreddits;
  if (
    Array.isArray(raw) &&
    raw.length > 0 &&
    raw.every((x): x is string => typeof x === "string" && x.length > 0)
  ) {
    return raw as string[];
  }
  return DEFAULT_SUBREDDITS;
}

export async function redditAdapter(ctx: AdapterContext): Promise<AdapterResult> {
  const clientId = process.env.REDDIT_CLIENT_ID?.trim();
  const clientSecret = process.env.REDDIT_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    // eslint-disable-next-line no-console
    console.log(
      "[reddit-adapter] REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET unset — skipping poll " +
        "(create a Reddit app: https://www.reddit.com/prefs/apps)",
    );
    return { candidates: [] };
  }

  const cfg = ctx.config ?? {};
  const ua = pickUserAgent(cfg);
  const subreddits = readSubreddits(cfg);
  const minScore = typeof cfg.minScore === "number" ? cfg.minScore : DEFAULT_MIN_SCORE;
  const limit =
    typeof cfg.limitPerSub === "number" ? cfg.limitPerSub : DEFAULT_LIMIT_PER_SUB;

  const token = await getAccessToken(clientId, clientSecret, ua);

  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  for (let i = 0; i < subreddits.length; i++) {
    const sub = subreddits[i]!;
    if (i > 0) await sleep(INTER_REQUEST_DELAY_MS);
    try {
      const posts = await fetchSubredditTop(token, sub, ua, limit);
      for (const post of posts) {
        if (!isUsablePost(post, minScore)) continue;
        if (seen.has(post.name!)) continue; // a post can sit in two subs' top
        seen.add(post.name!);
        candidates.push(buildCandidate(post, sub));
      }
    } catch (err) {
      // One subreddit failing must not abort the whole poll.
      // eslint-disable-next-line no-console
      console.error(
        `[reddit-adapter] r/${sub} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return { candidates };
}
