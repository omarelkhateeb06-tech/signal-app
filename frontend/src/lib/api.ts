import axios, { AxiosError, type AxiosInstance } from "axios";
import { useAuthStore } from "@/store/authStore";
import type {
  ApiError,
  AuthResponse,
  AuthUser,
  DepthPreference,
  DigestPreference,
  EmailFrequency,
  TopicInterest,
  UserProfile,
} from "@/types/auth";
import type {
  CommentaryEnvelope,
  FeedResponse,
  NativeArchiveParams,
  NativeArchiveResponse,
  SaveToggleResponse,
  SavedStoriesResponse,
  SearchEnvelope,
  SearchSort,
  Story,
  StoryDetailPayload,
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

// Phase 12h/12v — billing. Creates a Stripe Checkout session for the
// $10/mo Pro plan (monthly or annual) and returns the hosted-checkout
// URL the caller redirects to. The tier flips to `pro` on the webhook
// after a successful payment (server side).
export type BillingPlan = "monthly" | "annual";

export interface CheckoutSession {
  url: string;
}

export async function createCheckoutSession(
  plan: BillingPlan = "monthly",
): Promise<CheckoutSession> {
  const res = await api.post<{ data: CheckoutSession }>(
    "/api/v1/billing/checkout",
    { plan },
  );
  return res.data.data;
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
  // Phase 12b: settings page can now edit the depth preference added by
  // the onboarding questionnaire. Optional to preserve backward compat
  // for any older caller that doesn't supply it.
  depth_preference?: DepthPreference;
  // Phase 12c: Settings "Interests" card now also edits the full
  // commentary-input set. Optional for backward compat — the backend
  // diffs only the fields it receives, and leaves the others alone.
  domain?: string;
  seniority?: string;
  topic_interests?: { sector: string; topic: string }[];
}

export interface UpdateUserInput {
  name?: string;
  profile_picture_url?: string | null;
}

export interface MyProfileResponse {
  user: AuthUser;
  profile: UserProfile | null;
  topic_interests: TopicInterest[];
  onboarding_completed: boolean;
}

export async function getMyProfileRequest(): Promise<MyProfileResponse> {
  const res = await api.get<{ data: MyProfileResponse }>("/api/v1/users/me/profile");
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

// Phase 12g — tier snapshot for the trial badge / upgrade-CTA copy.
// `tier` is the effective tier (server lazy-downgrades expired
// pro_trial → free in this call). `trial_days_remaining` is non-null
// only for `pro_trial`. `trial_available` is true iff the user has
// never started a trial (drives "Start Free Trial" vs "Upgrade to
// Pro" copy).
export type ApiTier = "free" | "pro_trial" | "pro";
export interface TierSnapshot {
  tier: ApiTier;
  trial_days_remaining: number | null;
  trial_available: boolean;
}

export async function getMyTierRequest(): Promise<TierSnapshot> {
  const res = await api.get<{ data: TierSnapshot }>("/api/v1/users/me/tier");
  return res.data.data;
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

export async function getStoryRequest(id: string): Promise<StoryDetailPayload> {
  const res = await api.get<{ data: { story: StoryDetailPayload } }>(
    `/api/v1/stories/${id}`,
  );
  return res.data.data.story;
}

// Phase 12c — lazy per-user, per-story commentary fetch. The feed
// endpoint returns `commentary: null` for every row; this call
// hydrates one row. `depth` is optional: omit to let the server use
// the user's stored depth_preference (the common path); pass it for
// depth-selector overrides on story detail.
export async function getStoryCommentaryRequest(
  id: string,
  depth?: "accessible" | "briefed" | "technical",
): Promise<CommentaryEnvelope> {
  const res = await api.get<{ data: CommentaryEnvelope }>(
    `/api/v1/stories/${id}/commentary`,
    { params: depth ? { depth } : undefined },
  );
  return res.data.data;
}

// "The Through-Line" — a Pro-only daily editorial synthesis of what
// connects the day's top stories, generated server-side by Haiku and
// cached per reader per day. Free users get a gate envelope. `source`
// is "haiku" on success, "unavailable" when generation was skipped or
// failed (the UI hides the section in that case).
export interface ThroughLineResponse {
  through_line: string | null;
  source?: "haiku" | "unavailable";
  gated?: boolean;
  upgrade_cta?: { trial_available: boolean; message: string };
}

export async function getThroughLineRequest(
  storyIds: string[],
): Promise<ThroughLineResponse> {
  const res = await api.get<{ data: ThroughLineResponse }>(
    "/api/v1/briefing/through-line",
    { params: { storyIds: storyIds.join(",") } },
  );
  return res.data.data;
}

// Phase 12r — lean archive fetch: native events only, sorted newest first.
// No paywall, no sources batch — the archive table only needs id/headline/
// published_at/sector/generator_type.
export async function getNativeStoriesRequest(
  params: NativeArchiveParams = {},
): Promise<NativeArchiveResponse> {
  const query: Record<string, string> = {};
  if (params.limit !== undefined) query.limit = String(params.limit);
  if (params.offset !== undefined) query.offset = String(params.offset);
  const res = await api.get<{ data: NativeArchiveResponse }>(
    "/api/v1/stories/native",
    { params: query },
  );
  return res.data.data;
}

// Phase 12 — "In Focus" topic chips: top topics across recent events.
export interface InFocusTopic {
  topic: string;
  count: number;
}

export async function getInFocusRequest(): Promise<InFocusTopic[]> {
  const res = await api.get<{ data: { topics: InFocusTopic[] } }>(
    "/api/v1/stories/in-focus",
  );
  return res.data.data.topics;
}

// Phase 12 — coverage/activity dashboard.
export interface DashboardData {
  total_events_30d: number;
  sector_counts: Array<{ sector: string; count: number }>;
  volume_by_day: Array<{ date: string; count: number }>;
}

export async function getDashboardRequest(): Promise<DashboardData> {
  const res = await api.get<{ data: DashboardData }>("/api/v1/dashboard");
  return res.data.data;
}

export async function getRelatedStoriesRequest(id: string): Promise<Story[]> {
  const res = await api.get<{ data: { stories: Story[] } }>(
    `/api/v1/stories/${id}/related`,
  );
  return res.data.data.stories;
}

export interface EngagementEventInput {
  event_type: string;
  event_id?: string | null;
  dwell_ms?: number | null;
  metadata?: Record<string, unknown>;
  occurred_at?: string;
}

// Phase 12o — append-only engagement telemetry (batched). Best-effort; the
// caller (engagementTracker) swallows failures so telemetry never disrupts UX.
export async function postEngagementEventsRequest(
  events: EngagementEventInput[],
): Promise<void> {
  if (events.length === 0) return;
  await api.post("/api/v1/engagement/events", { events });
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
): Promise<SearchEnvelope> {
  const query: Record<string, string> = { q: params.q };
  if (params.sector) query.sector = params.sector;
  if (params.from_date) query.from_date = params.from_date;
  if (params.to_date) query.to_date = params.to_date;
  if (params.sort) query.sort = params.sort;
  if (params.limit !== undefined) query.limit = String(params.limit);
  if (params.offset !== undefined) query.offset = String(params.offset);
  const res = await api.get<{ data: SearchEnvelope }>(
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

// ---------- Onboarding (Phase 12b) ----------

export interface OnboardingCompleteInput {
  sectors: string[];
  role: string;
  // Phase 12c — Screen 2 field-within-sector dropdown. Required;
  // validated server-side against the DOMAIN_OPTIONS union including
  // the "general_not_sure" sentinel.
  domain: string;
  seniority: string;
  depth_preference: DepthPreference;
  topics: { sector: string; topic: string }[];
  goals: string[];
  digest_preference: DigestPreference;
  timezone: string;
}

export interface OnboardingEventInput {
  event_type: string;
  screen_number?: number | null;
  metadata?: Record<string, unknown>;
  occurred_at?: string;
}

export async function postOnboardingEventsRequest(
  events: OnboardingEventInput[],
): Promise<{ accepted: number }> {
  const res = await api.post<{ data: { accepted: number } }>(
    "/api/v1/onboarding/events",
    { events },
  );
  return res.data.data;
}

export async function postOnboardingCompleteRequest(
  input: OnboardingCompleteInput,
): Promise<{ profile: UserProfile; completed_at: string }> {
  const res = await api.post<{
    data: { profile: UserProfile; completed_at: string };
  }>("/api/v1/onboarding/complete", input);
  return res.data.data;
}

// Best-effort fire-and-forget beacon for screen_view / screen_skipped /
// time_on_screen events emitted from the onboarding screens. Uses
// sendBeacon when available (survives navigation + beforeunload) and
// falls back to a non-blocking POST otherwise. Never throws — telemetry
// must never break the flow.
export function sendOnboardingEventBeacon(events: OnboardingEventInput[]): void {
  if (typeof window === "undefined" || events.length === 0) return;
  const token = useAuthStore.getState().token;
  if (!token) return;
  const url = `${baseURL}/api/v1/onboarding/events`;
  const body = JSON.stringify({ events });
  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      // sendBeacon can't set custom headers, so the backend accepts
      // these events via the standard Bearer flow only when JS is
      // still alive. For beforeunload cases we fall back to a keepalive
      // fetch with the token in the header — Chrome's sendBeacon only
      // honors Content-Type text/plain-ish, which our zod schema would
      // reject. Fetch-with-keepalive is the sanctioned modern path.
    }
    void fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Intentionally swallow — telemetry must never surface errors.
  }
}
