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
  | "fallback_tier3";

// Phase 12d — commentary is structured: thesis renders by default,
// support reveals via a "Go deeper" affordance. Same shape across
// Haiku output and all fallback tiers; the consumer doesn't branch on
// `source` for layout.
export interface CommentaryShape {
  thesis: string;
  support: string;
}

export interface Story {
  id: string;
  sector: Sector | string;
  headline: string;
  context: string;
  why_it_matters: string;
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
  source_url: string;
  source_name: string | null;
  published_at: string | null;
  created_at: string;
  author: StoryAuthor | null;
  is_saved: boolean;
  save_count: number;
  comment_count: number;
}

// Response envelope for GET /api/v1/stories/:id/commentary. The
// `depth` field is echoed back because the server may have resolved
// a ?depth= override against the user's stored preference.
export interface CommentaryResponse {
  commentary: CommentaryShape;
  depth: "accessible" | "briefed" | "technical";
  profile_version: number;
  source: CommentarySource;
}

export interface FeedResponse {
  stories: Story[];
  total: number;
  has_more: boolean;
  limit: number;
  offset: number;
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

export type SearchSort = "relevance" | "newest" | "most_saved";

export interface SearchResponse {
  stories: SearchResultStory[];
  total: number;
  has_more: boolean;
  limit: number;
  offset: number;
  query: string;
}
