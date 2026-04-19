export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  profilePictureUrl?: string | null;
}

export type EmailFrequency = "daily" | "weekly" | "never";

export interface UserProfile {
  userId: string;
  sectors: string[] | null;
  role: string | null;
  goals: string[] | null;
  emailFrequency: EmailFrequency;
  emailUnsubscribed: boolean;
  createdAt?: string;
  updatedAt?: string;
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
