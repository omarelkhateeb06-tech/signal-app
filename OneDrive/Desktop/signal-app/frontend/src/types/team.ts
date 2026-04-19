export type TeamRole = "admin" | "member" | "viewer";

export interface TeamSettings {
  sectors: string[];
}

export interface Team {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  created_by: string | null;
  settings: TeamSettings;
  created_at: string;
  updated_at: string;
  role?: TeamRole;
}

export interface TeamMember {
  id: string;
  user_id: string;
  role: TeamRole;
  joined_at: string;
  email: string;
  name: string | null;
}

export interface TeamInvite {
  id: string;
  team_id: string;
  email: string;
  role: TeamRole;
  expires_at: string;
}

export interface TeamFeedStoryAuthor {
  id: string;
  name: string | null;
}

export interface TeamFeedStory {
  id: string;
  sector: string;
  headline: string;
  context: string;
  why_it_matters: string;
  source_url: string;
  source_name: string | null;
  published_at: string | null;
  created_at: string;
  author: TeamFeedStoryAuthor | null;
  save_count: number;
  team_comment_count: number;
}

export interface TeamFeedResponse {
  stories: TeamFeedStory[];
  total: number;
  has_more: boolean;
  limit: number;
  offset: number;
}

export interface TeamDashboardSectorCount {
  sector: string;
  count: number;
}

export interface TeamDashboardTopStory {
  id: string;
  headline: string;
  sector: string;
  save_count: number;
}

export interface TeamDashboard {
  team_id: string;
  member_count: number;
  total_comments: number;
  total_saves: number;
  sectors: string[];
  stories_by_sector: TeamDashboardSectorCount[];
  top_saved_stories: TeamDashboardTopStory[];
}
