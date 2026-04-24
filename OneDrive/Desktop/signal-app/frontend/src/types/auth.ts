export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  profilePictureUrl?: string | null;
}

export type EmailFrequency = "daily" | "weekly" | "never";

export type DepthPreference = "accessible" | "standard" | "technical";
export type DigestPreference = "morning" | "evening" | "none";

export interface UserProfile {
  userId: string;
  sectors: string[] | null;
  role: string | null;
  // Phase 12c — Screen 2 field-within-sector; feeds the Haiku prompt.
  domain: string | null;
  seniority: string | null;
  depthPreference: DepthPreference | null;
  goals: string[] | null;
  digestPreference: DigestPreference | null;
  timezone: string | null;
  completedAt: string | null;
  // Phase 12c — monotonic version integer. Bumped on post-onboarding
  // mutations to commentary-affecting profile fields (role, domain,
  // seniority, sectors, topics, goals). Part of the commentary_cache
  // key, so a bump invalidates prior cache rows on next view.
  profileVersion: number;
  emailFrequency: EmailFrequency;
  emailUnsubscribed: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface TopicInterest {
  sector: string;
  topic: string;
}

export interface AuthResponse {
  user: AuthUser;
  token: string;
}

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}
