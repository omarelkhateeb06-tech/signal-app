export type Sector = "ai" | "finance" | "semiconductors";

export interface StoryAuthor {
  id: string;
  name: string | null;
  bio: string | null;
}

export interface Story {
  id: string;
  sector: Sector | string;
  headline: string;
  context: string;
  why_it_matters: string;
  why_it_matters_to_you: string;
  source_url: string;
  source_name: string | null;
  published_at: string | null;
  created_at: string;
  author: StoryAuthor | null;
  is_saved: boolean;
  save_count: number;
  comment_count: number;
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
