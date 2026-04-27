"use client";

import { useCallback } from "react";
import { useAuthStore } from "@/store/authStore";
import { useTeamsStore } from "@/store/teamsStore";
import {
  loginRequest,
  logoutRequest,
  signupRequest,
  type LoginInput,
  type SignupInput,
} from "@/lib/api";
import type { AuthResponse, AuthUser } from "@/types/auth";

export interface UseAuthResult {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  hasHydrated: boolean;
  login: (input: LoginInput) => Promise<AuthResponse>;
  signup: (input: SignupInput) => Promise<AuthResponse>;
  logout: () => Promise<void>;
  setUser: (user: AuthUser) => void;
}

export function useAuth(): UseAuthResult {
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const setAuth = useAuthStore((s) => s.setAuth);
  const setUser = useAuthStore((s) => s.setUser);
  const clear = useAuthStore((s) => s.clear);

  const login = useCallback(
    async (input: LoginInput): Promise<AuthResponse> => {
      const result = await loginRequest(input);
      setAuth(result.user, result.token);
      return result;
    },
    [setAuth],
  );

  const signup = useCallback(
    async (input: SignupInput): Promise<AuthResponse> => {
      const result = await signupRequest(input);
      setAuth(result.user, result.token);
      return result;
    },
    [setAuth],
  );

  const logout = useCallback(async (): Promise<void> => {
    try {
      await logoutRequest();
    } finally {
      clear();
      useTeamsStore.getState().clear();
    }
  }, [clear]);

  return { user, token, isAuthenticated, hasHydrated, login, signup, logout, setUser };
}
