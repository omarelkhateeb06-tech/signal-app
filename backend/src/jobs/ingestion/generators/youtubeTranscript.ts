// Phase 12 ingestion Tier 2 — YouTube/podcast transcript dispatch generators.
//
// AUTHORS at most one native post per channel per run: the newest qualifying
// upload from a hand-curated channel list (Dwarkesh, Asianometry,
// TechTechPotato, No Priors, Acquired) becomes a DISPATCH-style brief — "what
// was said + why it matters." We never post the raw transcript; Haiku writes
// an original 40-second read grounded in the episode's captions (or, when
// captions are unavailable, strictly in the episode description, declining
// when that is too thin).
//
//   DISCOVER  YouTube Data API v3: resolve the channel handle → uploads
//             playlist → recent uploads (title, description, published-at).
//   QUALIFY   keep uploads inside the lookback window, not already posted
//             (external_id `youtube:{videoId}`), and long enough to be an
//             episode rather than a short/clip (videos.contentDetails check).
//   TRANSCRIPT fetch auto-captions via the public timedtext endpoint
//             (`kind=asr`, then manual-track fallback). Unofficial endpoint —
//             empty/missing yields description-only authoring, never a skip.
//   AUTHOR    one Haiku call writes the dispatch or DECLINES; the 3-tier
//             enrichment seam runs on the authored body.
//
// One generator INSTANCE per channel (factory + YOUTUBE_CHANNELS), each bound
// to its own ingestion_sources row (migration 0054) so per-channel dedup
// spaces and enable/disable stay independent — the registry pattern is one
// slug per generator.
//
// Requires YOUTUBE_API_KEY (Google Cloud, free read quota at this scale).
// When unset each instance logs and returns no candidates — the same
// graceful-degrade pattern as the FRED adapter. The key rides in query
// strings, so logs carry channel handles only, never URLs.

import {
  buildYouTubeDispatchPrompt,
  YOUTUBE_DISPATCH_ASSISTANT_PREFILL,
  YOUTUBE_DISPATCH_MAX_TOKENS,
  type YouTubeDispatchInputs,
} from "../../../llm/prompts/ingestion/youtubeTranscriptPrompt";
import {
  callHaikuForCommentary,
  type HaikuClientDeps,
} from "../../../services/haikuCommentaryClient";
import type { Sector } from "../relevanceSeam";
import type {
  NativeCandidate,
  NativeGenerator,
  NativeGeneratorContext,
} from "./types";
import { z } from "zod";

// ---- Channel roster ----

export interface YouTubeChannelSpec {
  // ingestion_sources.slug this instance writes under (one row per channel).
  slug: string;
  // YouTube @handle, without the "@" (Data API `forHandle` accepts both).
  handle: string;
  // Human show name used in prompts and summaries.
  displayName: string;
  sector: Sector;
}

// V1 roster — the hand-curated list from the ingestion-source plan. Adding a
// channel = one spec here + one source row in a migration.
export const YOUTUBE_CHANNELS: YouTubeChannelSpec[] = [
  { slug: "youtube-dwarkesh-native", handle: "dwarkeshpatel", displayName: "Dwarkesh Patel", sector: "ai" },
  { slug: "youtube-asianometry-native", handle: "Asianometry", displayName: "Asianometry", sector: "semiconductors" },
  { slug: "youtube-techtechpotato-native", handle: "TechTechPotato", displayName: "TechTechPotato", sector: "semiconductors" },
  { slug: "youtube-nopriors-native", handle: "nopriors", displayName: "No Priors", sector: "ai" },
  { slug: "youtube-acquired-native", handle: "AcquiredFM", displayName: "Acquired", sector: "finance" },
];

// ---- Config ----

export const DATA_API_BASE = "https://www.googleapis.com/youtube/v3";
export const TIMEDTEXT_BASE = "https://www.youtube.com/api/timedtext";

// Uploads newer than this qualify. Weekly-cadence shows publish ~1/week; 7
// days means a daily run catches each episode exactly once while it's fresh.
export const LOOKBACK_DAYS = 7;

// Floor that separates an episode from a Short / trailer / clip. 10 minutes
// is comfortably below any real episode on the roster and above any Short.
export const MIN_DURATION_SECONDS = 600;

// Below this many caption characters the "transcript" is noise (a music sting,
// a failed ASR run) — author from the description instead.
export const MIN_TRANSCRIPT_CHARS = 500;

// Caption text handed to the prompt is clipped to keep the call comfortably
// inside budget; the front of an episode carries the framing and thesis.
export const TRANSCRIPT_EXCERPT_MAX_CHARS = 12_000;
export const DESCRIPTION_MAX_CHARS = 2_000;

// One post per channel per run — the newest qualifying episode.
export const MAX_POSTS_PER_RUN = 1;

// Skip-before-author dedup look-back. Video ids never recur, so the per-source
// unique constraint is the real guard; this query just avoids paying a Haiku
// call to re-author an episode posted in a recent run.
export const DEDUP_WINDOW_DAYS = 30;

const FETCH_TIMEOUT_MS = 30_000;

// ---- Model output contract ----

const YouTubeDispatchOutputSchema = z
  .object({
    headline: z.string().min(8).max(200),
    body: z.string().min(200).max(2400),
  })
  .strict();

export type YouTubeDispatchOutput = z.infer<typeof YouTubeDispatchOutputSchema>;

export type AuthorOutcome =
  | { status: "authored"; output: YouTubeDispatchOutput }
  | { status: "skipped"; reason: string }
  | { status: "error"; reason: string };

// ---- Pure helpers (exported for tests) ----

// ISO-8601 duration ("PT1H23M45S", "P1DT2H") → whole seconds; 0 on anything
// unparseable.
export function parseIsoDuration(iso: string): number {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso.trim());
  if (!m || (!m[1] && !m[2] && !m[3] && !m[4])) return 0;
  const days = parseInt(m[1] ?? "0", 10);
  const hours = parseInt(m[2] ?? "0", 10);
  const minutes = parseInt(m[3] ?? "0", 10);
  const seconds = parseInt(m[4] ?? "0", 10);
  return ((days * 24 + hours) * 60 + minutes) * 60 + seconds;
}

// "1h 42m" / "47m" for prompt framing.
export function durationLabel(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.round((totalSeconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

// timedtext XML (`<transcript><text start dur>…</text>…`) → plain text.
// Caption payloads arrive double-encoded ("&amp;#39;"), so `&amp;` is decoded
// FIRST, then numeric/named entities.
export function timedtextToPlainText(xml: string): string {
  const inner = [...xml.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/gi)]
    .map((m) => m[1] ?? "")
    .join(" ");
  const decoded = inner
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
  return decoded.replace(/\s+/g, " ").trim();
}

export function clipText(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…`;
}

export function youtubeExternalId(videoId: string): string {
  return `youtube:${videoId}`;
}

// Human label for the prompt's recency framing.
function dateLabelOf(d: Date): string {
  return d.toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

const SECTOR_LABEL: Record<Sector, string> = {
  ai: "AI",
  finance: "finance",
  semiconductors: "semiconductors",
};

// ---- Data API response shapes (only the fields read) ----

interface ChannelsResponse {
  items?: Array<{
    contentDetails?: { relatedPlaylists?: { uploads?: string } };
  }>;
}

interface PlaylistItemsResponse {
  items?: Array<{
    snippet?: { title?: string; description?: string };
    contentDetails?: { videoId?: string; videoPublishedAt?: string };
  }>;
}

interface VideosResponse {
  items?: Array<{
    snippet?: { description?: string };
    contentDetails?: { duration?: string };
  }>;
}

interface RecentUpload {
  videoId: string;
  title: string;
  description: string;
  publishedAt: Date;
}

// ---- Generator deps (injectable for tests) ----

export interface YouTubeTranscriptDeps {
  fetchJson?: (url: string) => Promise<unknown>;
  fetchText?: (url: string) => Promise<string>;
  existingExternalIds?: (slug: string, now: Date) => Promise<Set<string>>;
  haiku?: HaikuClientDeps;
  authorPost?: (
    inputs: YouTubeDispatchInputs,
    haiku?: HaikuClientDeps,
  ) => Promise<AuthorOutcome>;
}

async function defaultFetch(url: string): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json,application/xml,text/xml" },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`http_${res.status}`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function defaultFetchJson(url: string): Promise<unknown> {
  return (await defaultFetch(url)).json();
}

async function defaultFetchText(url: string): Promise<string> {
  return (await defaultFetch(url)).text();
}

// External IDs this channel's source already produced in the dedup window.
// Fail-OPEN: any DB error returns an empty set (the per-source unique
// constraint still blocks a duplicate row on insert). Lazy-imports the db so
// the pure helpers above stay import-light and test-friendly.
async function defaultExistingExternalIds(
  slug: string,
  now: Date,
): Promise<Set<string>> {
  try {
    const [{ db }, schema, drizzle] = await Promise.all([
      import("../../../db"),
      import("../../../db/schema"),
      import("drizzle-orm"),
    ]);
    const { ingestionCandidates, ingestionSources } = schema;
    const { and, eq, gt } = drizzle;
    const since = new Date(now.getTime() - DEDUP_WINDOW_DAYS * 24 * 3600 * 1000);
    const rows = await db
      .select({ externalId: ingestionCandidates.externalId })
      .from(ingestionCandidates)
      .innerJoin(
        ingestionSources,
        eq(ingestionCandidates.ingestionSourceId, ingestionSources.id),
      )
      .where(
        and(
          eq(ingestionSources.slug, slug),
          gt(ingestionCandidates.discoveredAt, since),
        ),
      );
    return new Set(rows.map((r) => r.externalId));
  } catch {
    return new Set();
  }
}

async function defaultAuthorPost(
  inputs: YouTubeDispatchInputs,
  haiku?: HaikuClientDeps,
): Promise<AuthorOutcome> {
  const prompt = buildYouTubeDispatchPrompt(inputs);
  const result = await callHaikuForCommentary(prompt, haiku, {
    assistantPrefill: YOUTUBE_DISPATCH_ASSISTANT_PREFILL,
    maxTokens: YOUTUBE_DISPATCH_MAX_TOKENS,
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
  const validated = YouTubeDispatchOutputSchema.safeParse(parsed);
  return validated.success
    ? { status: "authored", output: validated.data }
    : { status: "error", reason: "schema_invalid" };
}

// ---- Per-channel API steps ----

async function resolveUploadsPlaylist(
  fetchJson: (url: string) => Promise<unknown>,
  handle: string,
  apiKey: string,
): Promise<string | null> {
  const url =
    `${DATA_API_BASE}/channels?part=contentDetails` +
    `&forHandle=${encodeURIComponent(handle)}&key=${apiKey}`;
  const json = (await fetchJson(url)) as ChannelsResponse;
  return json.items?.[0]?.contentDetails?.relatedPlaylists?.uploads ?? null;
}

async function listRecentUploads(
  fetchJson: (url: string) => Promise<unknown>,
  playlistId: string,
  apiKey: string,
): Promise<RecentUpload[]> {
  const url =
    `${DATA_API_BASE}/playlistItems?part=snippet,contentDetails` +
    `&playlistId=${encodeURIComponent(playlistId)}&maxResults=10&key=${apiKey}`;
  const json = (await fetchJson(url)) as PlaylistItemsResponse;
  const uploads: RecentUpload[] = [];
  for (const item of json.items ?? []) {
    const videoId = item.contentDetails?.videoId;
    const publishedRaw = item.contentDetails?.videoPublishedAt;
    const title = item.snippet?.title;
    if (!videoId || !publishedRaw || !title) continue;
    const publishedAt = new Date(publishedRaw);
    if (Number.isNaN(publishedAt.getTime())) continue;
    uploads.push({
      videoId,
      title,
      description: item.snippet?.description ?? "",
      publishedAt,
    });
  }
  return uploads.sort(
    (a, b) => b.publishedAt.getTime() - a.publishedAt.getTime(),
  );
}

interface VideoDetail {
  durationSeconds: number;
  description: string;
}

async function fetchVideoDetail(
  fetchJson: (url: string) => Promise<unknown>,
  videoId: string,
  apiKey: string,
): Promise<VideoDetail | null> {
  const url =
    `${DATA_API_BASE}/videos?part=contentDetails,snippet` +
    `&id=${encodeURIComponent(videoId)}&key=${apiKey}`;
  const json = (await fetchJson(url)) as VideosResponse;
  const item = json.items?.[0];
  if (!item) return null;
  return {
    durationSeconds: parseIsoDuration(item.contentDetails?.duration ?? ""),
    description: item.snippet?.description ?? "",
  };
}

// Auto-captions first (`kind=asr` — the norm for podcast channels), then the
// manual English track. Unofficial endpoint: any failure or an empty/short
// payload returns null and the dispatch authors from the description.
async function fetchTranscript(
  fetchText: (url: string) => Promise<string>,
  videoId: string,
): Promise<string | null> {
  const variants = [
    `${TIMEDTEXT_BASE}?v=${encodeURIComponent(videoId)}&lang=en&kind=asr`,
    `${TIMEDTEXT_BASE}?v=${encodeURIComponent(videoId)}&lang=en`,
  ];
  for (const url of variants) {
    try {
      const xml = await fetchText(url);
      const text = timedtextToPlainText(xml);
      if (text.length >= MIN_TRANSCRIPT_CHARS) return text;
    } catch {
      // try the next variant
    }
  }
  return null;
}

// ---- Factory ----

export function createYouTubeTranscriptGenerator(
  channel: YouTubeChannelSpec,
  deps: YouTubeTranscriptDeps = {},
): NativeGenerator {
  const fetchJson = deps.fetchJson ?? defaultFetchJson;
  const fetchText = deps.fetchText ?? defaultFetchText;
  const existingExternalIds =
    deps.existingExternalIds ?? defaultExistingExternalIds;
  const authorPost = deps.authorPost ?? defaultAuthorPost;

  return {
    slug: channel.slug,
    async generate(ctx: NativeGeneratorContext): Promise<NativeCandidate[]> {
      const apiKey = process.env.YOUTUBE_API_KEY?.trim();
      if (!apiKey) {
        // eslint-disable-next-line no-console
        console.log(
          `[youtube-transcript] YOUTUBE_API_KEY unset — skipping ${channel.slug}`,
        );
        return [];
      }

      const now = ctx.now();
      const emit = ctx.onDiagnostic;

      try {
        // 1) DISCOVER — recent uploads via handle → uploads playlist.
        const playlistId = await resolveUploadsPlaylist(
          fetchJson,
          channel.handle,
          apiKey,
        );
        if (!playlistId) {
          emit?.({
            stage: "discover",
            identifier: channel.handle,
            decision: "reject",
            reason: "channel_not_resolved",
          });
          return [];
        }
        const uploads = await listRecentUploads(fetchJson, playlistId, apiKey);

        // 2) QUALIFY — window, dedup, episode-length floor (newest first).
        const windowStart =
          now.getTime() - LOOKBACK_DAYS * 24 * 3600 * 1000;
        const already = await existingExternalIds(channel.slug, now);

        for (const upload of uploads) {
          const externalId = youtubeExternalId(upload.videoId);
          let reason: string | null = null;
          if (upload.publishedAt.getTime() < windowStart) reason = "outside_window";
          else if (already.has(externalId)) reason = "already_posted";

          if (reason) {
            emit?.({
              stage: "qualify",
              identifier: upload.videoId,
              decision: "reject",
              reason,
              signals: { published_at: upload.publishedAt.toISOString() },
            });
            continue;
          }

          const detail = await fetchVideoDetail(fetchJson, upload.videoId, apiKey);
          const durationSeconds = detail?.durationSeconds ?? 0;
          if (durationSeconds < MIN_DURATION_SECONDS) {
            emit?.({
              stage: "qualify",
              identifier: upload.videoId,
              decision: "reject",
              reason: "below_duration_floor",
              detail: `${durationSeconds}s < ${MIN_DURATION_SECONDS}s`,
            });
            continue;
          }
          emit?.({
            stage: "qualify",
            identifier: upload.videoId,
            decision: "pass",
            reason: null,
            signals: { duration_s: durationSeconds },
          });

          // 3) TRANSCRIPT — best-effort; description-only is a valid mode.
          const transcript = await fetchTranscript(fetchText, upload.videoId);
          emit?.({
            stage: "transcript",
            identifier: upload.videoId,
            decision: transcript ? "pass" : "reject",
            reason: transcript ? null : "captions_unavailable",
          });

          // 4) AUTHOR — one Haiku call; decline is a clean no-post.
          const videoUrl = `https://www.youtube.com/watch?v=${upload.videoId}`;
          const description = clipText(
            (detail?.description || upload.description).trim(),
            DESCRIPTION_MAX_CHARS,
          );
          const inputs: YouTubeDispatchInputs = {
            channelName: channel.displayName,
            sectorLabel: SECTOR_LABEL[channel.sector],
            videoTitle: upload.title,
            videoUrl,
            publishedLabel: dateLabelOf(upload.publishedAt),
            durationLabel: durationLabel(durationSeconds),
            description,
            transcriptExcerpt: transcript
              ? clipText(transcript, TRANSCRIPT_EXCERPT_MAX_CHARS)
              : null,
          };

          const outcome = await authorPost(inputs, deps.haiku);
          emit?.({
            stage: "author",
            identifier: externalId,
            url: videoUrl,
            decision: outcome.status === "authored" ? "pass" : "reject",
            reason: outcome.status === "authored" ? null : outcome.reason,
            detail:
              outcome.status === "authored"
                ? outcome.output.headline
                : `${outcome.status}: ${outcome.reason}`,
          });
          if (outcome.status !== "authored") return [];

          const candidate: NativeCandidate = {
            externalId,
            url: videoUrl,
            headline: outcome.output.headline,
            body: outcome.output.body,
            sector: channel.sector,
            summary: `${channel.displayName} — "${upload.title}" (${dateLabelOf(upload.publishedAt)}).`,
            rawPayload: {
              generator: "youtube-transcript",
              channel_slug: channel.slug,
              channel_handle: channel.handle,
              video_id: upload.videoId,
              video_title: upload.title,
              published_at: upload.publishedAt.toISOString(),
              duration_seconds: durationSeconds,
              used_transcript: transcript !== null,
              transcript_chars: transcript?.length ?? 0,
            },
          };
          return [candidate]; // MAX_POSTS_PER_RUN = 1
        }

        return [];
      } catch (err) {
        // One channel failing must not abort the shared native run (the
        // runner has no per-generator try/catch). Handle only — request
        // URLs carry the API key and must never be logged.
        // eslint-disable-next-line no-console
        console.error(
          `[youtube-transcript] ${channel.slug} failed:`,
          err instanceof Error ? err.message : err,
        );
        return [];
      }
    },
  };
}

// Default instances registered in generators/index.ts — one per channel.
export const youtubeTranscriptGenerators: NativeGenerator[] =
  YOUTUBE_CHANNELS.map((channel) => createYouTubeTranscriptGenerator(channel));
