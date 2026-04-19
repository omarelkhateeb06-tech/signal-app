import axios, { AxiosError, type AxiosInstance } from "axios";
import { useAuthStore } from "@/store/authStore";
import type { ApiError, AuthResponse, AuthUser } from "@/types/auth";

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
      const { clear } = useAuthStore.getState();
      clear();
      const { pathname } = window.location;
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

export async function meRequest(): Promise<{ user: AuthUser; profile: unknown }> {
  const res = await api.get<{ data: { user: AuthUser; profile: unknown } }>("/api/v1/auth/me");
  return res.data.data;
}

export async function logoutRequest(): Promise<void> {
  await api.post("/api/v1/auth/logout");
}
