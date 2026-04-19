export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
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
