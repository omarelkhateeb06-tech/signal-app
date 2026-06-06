export type Sector = "ai" | "finance" | "semiconductors";

export interface StoryAuthor {
  id: string;
  name: string | null;
  bio: string | null;
}

// Phase 12c — per-user, per-story commentary that the client hydrates
// lazily after the feed lands. Possible values on the wire:
//   "cache"           — served from commentary_cache, same user+story+depth+version
//   "haiku"           — freshly generated
//   "fallback_tier1"  — template with matched sector + topic overlap
//   "fallback_tier2"  — template with matched sector, no topic overlap
//   "fallback_tier3"  — template with anomaly (missing profile, off_sector,
//                       or any Haiku-side failure). Not cached on the server.
// The client currently treats all non-null sources as equivalent for
// display, but the field is preserved for future telemetry (e.g. a
// "generating…" affordance while tier3 regenerates on next view).
export type CommentarySource =
  | "cache"
  | "haiku"
  | "fallback_tier1"
  | "fallback_tier2"
  | "fallback_tier3"
  // Phase 12g — free-tier path returns pre-generated role-neutral
  // commentary directly from the row, skipping Haiku and the cache.
  | "generic";

// Phase 12d — commentary is structured: thesis renders by default,
// support reveals via a "Go deeper" affordance. Same shape across
// Haiku output and all fallback tiers; the consumer doesn't branch on
// `source` for layout.
export interface CommentaryShape {
  thesis: string;
  support: string;
}

// Phase 12g — gate envelope shape. Returned in place of the full
// story / commentary / search payloads when the server applies a
// paywall gate (story cap, depth restriction, search cap). The
// frontend discriminates on the `gated` boolean.
export type GateReason = "story_limit" | "depth" | "search_limit";

export interface GateUpgradeCta {
  trial_available: boolean;
  message: string;
}

export interface GatePayload {
  gated: true;
  gate_reason: GateReason;
  teaser: { headline: string; first_line: string };
  upgrade_cta: GateUpgradeCta;
}

// Feed-list gate item. Carries id + sector at the top so list
// consumers stay correlatable.
export interface FeedGatedStory extends GatePayload {
  id: string;
  sector: Sector | string;
  gate_reason: "story_limit";
}

export type FeedItem = (Story & { gated: false }) | FeedGatedStory;

export function isGatedFeedItem(item: FeedItem): item is FeedGatedStory {
  return item.gated === true;
}

export interface Story {
  id: string;
  sector: Sector | string;
  headline: string;
  context: string;
  why_it_matters: string;
  // Phase 12g — discriminant. Full Story payload always carries
  // `gated: false`; the gated branch is a separate envelope.
  gated: false;
  // Phase 12n.3 — explicit story kind. "native" = SIGNAL-authored
  // editorial synthesis; "ingested" = sourced from an external outlet.
  // The client discriminates on THIS field (the server derives it from
  // events.source_type) rather than inferring native-ness from the
  // source display name, which was a brittle human-facing signal.
  kind: "native" | "ingested";
  // Phase 12b personalization output. Kept on the payload through the
  // 12c rollout so any surface that hasn't been migrated to the
  // lazy-commentary hook still has something to render. Removed in 12d.
  why_it_matters_to_you: string;
  // Phase 12c: null on feed-list responses; populated by the dedicated
  // /stories/:id/commentary endpoint. `commentary_source` mirrors the
  // service-layer CommentaryResult.source and is null until hydrated.
  // 12d: shape switched from `string` to `{thesis, support}` so the UI
  // can split the rendered text between default (thesis) and the
  // "Go deeper" expansion (support). Server payload is the same
  // jsonb shape that lands in commentary_cache.
  commentary: CommentaryShape | null;
  commentary_source: CommentarySource | null;
  // Phase 12n — role-neutral commentary, always present on the feed
  // wire (null only for legacy rows never backfilled). The feed card
  // splits this into a hook title (first sentence, shown as the
  // headline) and a commentary body (the remainder). Null falls back to
  // the source `headline` as the hook title.
  generic_commentary: string | null;
  // Phase 12o — for native (SIGNAL) posts, the slug of the generating
  // source (e.g. "arxiv-synthesis-native"), which the card maps to a
  // brand label ("The Research Read", …) in the source kicker. Null for
  // ingested stories and for native posts whose generator has no brand
  // mapping (they keep the plain "SIGNAL" attribution).
  generator_type: string | null;
  source_url: string;
  source_name: string | null;
  // Phase 12e.7a: multi-source attribution for ingestion-written events.
  // Legacy hand-curated stories carry a synthetic single-element array
  // so the wire shape is uniform across legacy and ingestion items.
  primary_source_url: string | null;
  sources: Array<{ url: string; name: string | null; role: "primary" | "alternate" }>;
  // Phase 12k — og:image URL extracted from the source page during
  // enrichment. Null when no og:image / twitter:image was found; the UI
  // renders no thumbnail / hero in that case (no placeholder).
  image_url: string | null;
  // Phase 12s — AI-generated editorial illustration for native (SIGNAL)
  // posts. Null for ingested stories and legacy rows. The UI surfaces it
  // only for native posts; `image_url` takes priority when both are set.
  illustration_url: string | null;
  // Phase 12u — content-type classification. 'filing' for SEC / earnings
  // events (server-derived from the EDGAR adapter); null for general news
  // and native posts. Drives the data-led "Earnings / SEC" feed card.
  content_type: "filing" | "general" | null;
  published_at: string | null;
  created_at: string;
  author: StoryAuthor | null;
  is_saved: boolean;
  save_count: number;
  comment_count: number;
  reading_time_minutes?: number;
}

// Response envelope for GET /api/v1/stories/:id/commentary. The
// `depth` field is echoed back because the server may have resolved
// a ?depth= override against the user's stored preference.
export interface CommentaryResponse {
  commentary: CommentaryShape;
  depth: "accessible" | "briefed" | "technical";
  profile_version: number;
  source: CommentarySource;
  gated?: false;
}

export interface FeedResponse {
  stories: FeedItem[];
  total: number;
  has_more: boolean;
  limit: number;
  offset: number;
}

// Phase 12g — the story detail endpoint returns either the full Story
// shape (gated:false) or a GatePayload (gated:true, reason:"story_limit").
export type StoryDetailPayload = Story | GatePayload;

// Commentary endpoint can return either the normal response or a
// gate envelope (gated:true, reason:"depth").
export type CommentaryEnvelope = CommentaryResponse | GatePayload;

// Search endpoint returns either results or a gate envelope
// (gated:true, reason:"search_limit").
export type SearchEnvelope = SearchResponse | GatePayload;

export function isGatePayload(
  value: { gated?: boolean } | null | undefined,
): value is GatePayload {
  return !!value && value.gated === true;
}

export interface SavedStory extends Story {
  saved_at: string;
}

export interface SavedStoriesResponse {
  stories: SavedStory[];
  total: number;
  has_more: boolean;
  limit: number;
  offset: number;
}

export interface SaveToggleResponse {
  saved: boolean;
  save_count: number;
}

export interface SearchResultStory extends Story {
  rank: number;
}

// Phase 12r — native archive endpoint. Lean shape: just the fields the
// archive table needs. No sources, no commentary, no paywall fields.
export interface NativeArchiveItem {
  id: string;
  headline: string;
  published_at: string | null;
  created_at: string;
  sector: Sector | string;
  // Slug of the generating source (e.g. "arxiv-synthesis-native"), mapped
  // to a brand label by `brandLabelForGeneratorType` in feedCard.ts.
  generator_type: string | null;
  // Phase 12s — editorial illustration URL (native posts only). Null
  // until the post has been illustrated.
  illustration_url: string | null;
}

export interface NativeArchiveParams {
  limit?: number;
  offset?: number;
}

export interface NativeArchiveResponse {
  items: NativeArchiveItem[];
  total: number;
  has_more: boolean;
  limit: number;
  offset: number;
}

export type SearchSort = "relevance" | "newest" | "most_saved";

export interface SearchResponse {
  stories: SearchResultStory[];
  total: number;
  has_more: boolean;
  limit: number;
  offset: number;
  query: string;
  // Phase 12g discriminant. Present on the wire shape for narrowing
  // against the SearchEnvelope union; the gated branch is GatePayload.
  gated?: false;
}
