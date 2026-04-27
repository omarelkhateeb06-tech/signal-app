"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./useAuth";

export function useRequireAuth(redirectTo = "/login"): { ready: boolean; isAuthenticated: boolean } {
  const router = useRouter();
  const { isAuthenticated, hasHydrated } = useAuth();

  useEffect(() => {
    if (hasHydrated && !isAuthenticated) {
      router.replace(redirectTo);
    }
  }, [hasHydrated, isAuthenticated, redirectTo, router]);

  return { ready: hasHydrated && isAuthenticated, isAuthenticated };
}
