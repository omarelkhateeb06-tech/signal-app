import axios, { AxiosError, type AxiosInstance } from "axios";
import { useAuthStore } from "@/store/authStore";
import type { ApiError, AuthResponse, AuthUser, EmailFrequency, UserProfile } from "@/types/auth";
import type {
  FeedResponse,
  SaveToggleResponse,
  SavedStoriesResponse,
  SearchResponse,
  SearchSort,
  Story,
} from "@/types/story";
import type { Comment, CommentList } from "@/types/comment";
import type {
  InviteAcceptInput,
  InviteAcceptResponse,
  InviteMetadata,
  PendingTeamInvite,
  Team,
  TeamDashboard,
  TeamFeedResponse,
  TeamInvite,
  TeamMember,
  TeamRole,
} from "@/types/team";

const baseURL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export const api: AxiosInstance = axios.create({
  baseURL,
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = useAuthStore.getState().token;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError<{ error?: ApiError }>) => {
    if (error.response?.status === 401 && typeof window !== "undefined") {
      const { pathname } = window.location;
      // The join page handles its own 401s (wrong password on invite accept)
      // inline and must not wipe an unrelated signed-in session.
      if (pathname.startsWith("/teams/join")) {
        return Promise.reject(error);
      }
      const { clear } = useAuthStore.getState();
      clear();
      if (!pathname.startsWith("/login") && !pathname.startsWith("/signup")) {
        window.location.assign("/login");
      }
    }
    return Promise.reject(error);
  },
);

export function extractApiError(error: unknown, fallback = "Something went wrong"): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { error?: ApiError } | undefined;
    return data?.error?.message ?? fallback;
  }
  return fallback;
}

export interface SignupInput {
  email: string;
  password: string;
  name: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export async function signupRequest(input: SignupInput): Promise<AuthResponse> {
  const res = await api.post<{ data: AuthResponse }>("/api/v1/auth/signup", input);
  return res.data.data;
}

export async function loginRequest(input: LoginInput): Promise<AuthResponse> {
  const res = await api.post<{ data: AuthResponse }>("/api/v1/auth/login", input);
  return res.data.data;
}

export async function meRequest(): Promise<{ user: AuthUser; profile: UserProfile | null }> {
  const res = await api.get<{ data: { user: AuthUser; profile: UserProfile | null } }>(
    "/api/v1/auth/me",
  );
  return res.data.data;
}

export async function logoutRequest(): Promise<void> {
  await api.post("/api/v1/auth/logout");
}

export interface UpdateProfileInput {
  sectors: string[];
  role: string;
  goals: string[];
  email_frequency: EmailFrequency;
  email_unsubscribed?: boolean;
}

export interface UpdateUserInput {
  name?: string;
  profile_picture_url?: string | null;
}

export async function getMyProfileRequest(): Promise<{
  user: AuthUser;
  profile: UserProfile | null;
}> {
  const res = await api.get<{ data: { user: AuthUser; profile: UserProfile | null } }>(
    "/api/v1/users/me/profile",
  );
  return res.data.data;
}

export async function updateMyProfileRequest(
  input: UpdateProfileInput,
): Promise<UserProfile> {
  const res = await api.put<{ data: { profile: UserProfile } }>(
    "/api/v1/users/me/profile",
    input,
  );
  return res.data.data.profile;
}

export async function updateMeRequest(input: UpdateUserInput): Promise<AuthUser> {
  const res = await api.put<{ data: { user: AuthUser } }>("/api/v1/users/me", input);
  return res.data.data.user;
}

export interface EmailPreferencesInput {
  email_frequency?: EmailFrequency;
  email_unsubscribed?: boolean;
}

export interface EmailPreferencesResponse {
  email_frequency: EmailFrequency;
  email_unsubscribed: boolean;
}

export async function updateEmailPreferencesRequest(
  input: EmailPreferencesInput,
): Promise<EmailPreferencesResponse> {
  const res = await api.put<{ data: { profile: EmailPreferencesResponse } }>(
    "/api/v1/emails/preferences",
    input,
  );
  return res.data.data.profile;
}

export async function unsubscribeRequest(
  token: string,
): Promise<{ email: string; unsubscribed: boolean }> {
  const res = await api.post<{ data: { email: string; unsubscribed: boolean } }>(
    "/api/v1/emails/unsubscribe",
    { token },
  );
  return res.data.data;
}

export interface FeedParams {
  sectors?: string[];
  limit?: number;
  offset?: number;
}

export async function getFeedRequest(params: FeedParams = {}): Promise<FeedResponse> {
  const query: Record<string, string> = {};
  if (params.sectors && params.sectors.length > 0) {
    query.sectors = params.sectors.join(",");
  }
  if (params.limit !== undefined) query.limit = String(params.limit);
  if (params.offset !== undefined) query.offset = String(params.offset);

  const res = await api.get<{ data: FeedResponse }>("/api/v1/stories/feed", {
    params: query,
  });
  return res.data.data;
}

export async function getStoryRequest(id: string): Promise<Story> {
  const res = await api.get<{ data: { story: Story } }>(`/api/v1/stories/${id}`);
  return res.data.data.story;
}

export async function getRelatedStoriesRequest(id: string): Promise<Story[]> {
  const res = await api.get<{ data: { stories: Story[] } }>(
    `/api/v1/stories/${id}/related`,
  );
  return res.data.data.stories;
}

export async function saveStoryRequest(id: string): Promise<SaveToggleResponse> {
  const res = await api.post<{ data: SaveToggleResponse }>(
    `/api/v1/stories/${id}/save`,
  );
  return res.data.data;
}

export async function unsaveStoryRequest(id: string): Promise<SaveToggleResponse> {
  const res = await api.delete<{ data: SaveToggleResponse }>(
    `/api/v1/stories/${id}/save`,
  );
  return res.data.data;
}

export interface SavedParams {
  limit?: number;
  offset?: number;
}

export async function getMySavesRequest(
  params: SavedParams = {},
): Promise<SavedStoriesResponse> {
  const query: Record<string, string> = {};
  if (params.limit !== undefined) query.limit = String(params.limit);
  if (params.offset !== undefined) query.offset = String(params.offset);
  const res = await api.get<{ data: SavedStoriesResponse }>(
    "/api/v1/users/me/saves",
    { params: query },
  );
  return res.data.data;
}

export interface SearchParams {
  q: string;
  sector?: string;
  from_date?: string;
  to_date?: string;
  sort?: SearchSort;
  limit?: number;
  offset?: number;
}

export async function searchStoriesRequest(
  params: SearchParams,
): Promise<SearchResponse> {
  const query: Record<string, string> = { q: params.q };
  if (params.sector) query.sector = params.sector;
  if (params.from_date) query.from_date = params.from_date;
  if (params.to_date) query.to_date = params.to_date;
  if (params.sort) query.sort = params.sort;
  if (params.limit !== undefined) query.limit = String(params.limit);
  if (params.offset !== undefined) query.offset = String(params.offset);
  const res = await api.get<{ data: SearchResponse }>(
    "/api/v1/stories/search",
    { params: query },
  );
  return res.data.data;
}

export interface CommentListParams {
  limit?: number;
  offset?: number;
}

export async function getStoryCommentsRequest(
  storyId: string,
  params: CommentListParams = {},
): Promise<CommentList> {
  const query: Record<string, string> = {};
  if (params.limit !== undefined) query.limit = String(params.limit);
  if (params.offset !== undefined) query.offset = String(params.offset);
  const res = await api.get<{ data: CommentList }>(
    `/api/v1/stories/${storyId}/comments`,
    { params: query },
  );
  return res.data.data;
}

export async function getRepliesRequest(commentId: string): Promise<Comment[]> {
  const res = await api.get<{ data: { comments: Comment[] } }>(
    `/api/v1/comments/${commentId}/replies`,
  );
  return res.data.data.comments;
}

export interface CreateCommentInput {
  content: string;
  parent_comment_id?: string | null;
}

export async function createCommentRequest(
  storyId: string,
  input: CreateCommentInput,
): Promise<Comment> {
  const res = await api.post<{ data: { comment: Comment } }>(
    `/api/v1/stories/${storyId}/comments`,
    input,
  );
  return res.data.data.comment;
}

export async function updateCommentRequest(
  commentId: string,
  content: string,
): Promise<Comment> {
  const res = await api.patch<{ data: { comment: Comment } }>(
    `/api/v1/comments/${commentId}`,
    { content },
  );
  return res.data.data.comment;
}

export async function deleteCommentRequest(commentId: string): Promise<void> {
  await api.delete(`/api/v1/comments/${commentId}`);
}

// ---------- Teams ----------

export interface CreateTeamInput {
  name: string;
  slug: string;
  description?: string | null;
}

export interface UpdateTeamInput {
  name?: string;
  description?: string | null;
  slug?: string;
}

export interface InviteMemberInput {
  email: string;
  role?: TeamRole;
}

export async function listTeamsRequest(): Promise<Team[]> {
  const res = await api.get<{ data: { teams: Team[] } }>("/api/v1/teams");
  return res.data.data.teams;
}

export async function getTeamRequest(teamId: string): Promise<Team> {
  const res = await api.get<{ data: { team: Team } }>(`/api/v1/teams/${teamId}`);
  return res.data.data.team;
}

export async function createTeamRequest(input: CreateTeamInput): Promise<Team> {
  const res = await api.post<{ data: { team: Team } }>("/api/v1/teams", input);
  return res.data.data.team;
}

export async function updateTeamRequest(
  teamId: string,
  input: UpdateTeamInput,
): Promise<Team> {
  const res = await api.patch<{ data: { team: Team } }>(
    `/api/v1/teams/${teamId}`,
    input,
  );
  return res.data.data.team;
}

export async function deleteTeamRequest(teamId: string): Promise<void> {
  await api.delete(`/api/v1/teams/${teamId}`);
}

export async function listTeamMembersRequest(
  teamId: string,
): Promise<TeamMember[]> {
  const res = await api.get<{ data: { members: TeamMember[] } }>(
    `/api/v1/teams/${teamId}/members`,
  );
  return res.data.data.members;
}

export async function removeTeamMemberRequest(
  teamId: string,
  userId: string,
): Promise<void> {
  await api.delete(`/api/v1/teams/${teamId}/members/${userId}`);
}

export async function inviteTeamMemberRequest(
  teamId: string,
  input: InviteMemberInput,
): Promise<TeamInvite> {
  const res = await api.post<{ data: { invite: TeamInvite } }>(
    `/api/v1/teams/${teamId}/invites`,
    input,
  );
  return res.data.data.invite;
}

export interface TeamFeedParams {
  limit?: number;
  offset?: number;
}

export async function getTeamFeedRequest(
  teamId: string,
  params: TeamFeedParams = {},
): Promise<TeamFeedResponse> {
  const query: Record<string, string> = {};
  if (params.limit !== undefined) query.limit = String(params.limit);
  if (params.offset !== undefined) query.offset = String(params.offset);
  const res = await api.get<{ data: TeamFeedResponse }>(
    `/api/v1/teams/${teamId}/feed`,
    { params: query },
  );
  return res.data.data;
}

export async function updateTeamSettingsRequest(
  teamId: string,
  sectors: string[],
): Promise<Team> {
  const res = await api.patch<{ data: { team: Team } }>(
    `/api/v1/teams/${teamId}/settings`,
    { sectors },
  );
  return res.data.data.team;
}

export async function getTeamDashboardRequest(
  teamId: string,
): Promise<TeamDashboard> {
  const res = await api.get<{ data: TeamDashboard }>(
    `/api/v1/teams/${teamId}/dashboard`,
  );
  return res.data.data;
}

export async function inviteMetadataRequest(
  token: string,
): Promise<InviteMetadata> {
  const res = await api.get<{ data: InviteMetadata }>(
    "/api/v1/teams/invite/metadata",
    { params: { token } },
  );
  return res.data.data;
}

export async function inviteAcceptRequest(
  input: InviteAcceptInput,
): Promise<InviteAcceptResponse> {
  const res = await api.post<{ data: InviteAcceptResponse }>(
    "/api/v1/teams/invite/accept",
    input,
  );
  return res.data.data;
}

export async function listTeamInvitesRequest(
  teamId: string,
): Promise<PendingTeamInvite[]> {
  const res = await api.get<{ data: { invites: PendingTeamInvite[] } }>(
    `/api/v1/teams/${teamId}/invites`,
  );
  return res.data.data.invites;
}

export async function resendTeamInviteRequest(
  teamId: string,
  inviteId: string,
): Promise<TeamInvite> {
  const res = await api.post<{ data: { invite: TeamInvite } }>(
    `/api/v1/teams/${teamId}/invites/${inviteId}/resend`,
  );
  return res.data.data.invite;
}

export async function revokeTeamInviteRequest(
  teamId: string,
  inviteId: string,
): Promise<void> {
  await api.delete(`/api/v1/teams/${teamId}/invites/${inviteId}`);
}
