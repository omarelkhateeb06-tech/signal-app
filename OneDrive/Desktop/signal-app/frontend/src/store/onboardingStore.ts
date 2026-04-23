"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { DepthPreference, DigestPreference } from "@/types/auth";

// Phase 12b — the mid-flow state for the 7-screen onboarding
// questionnaire. Persisted to sessionStorage (NOT localStorage) so a
// hard refresh mid-flow recovers the user's progress, but closing the
// tab or signing out wipes it. localStorage would leak stale state
// across accounts on a shared machine.

export interface OnboardingState {
  // Screen 1 — required, multi-select
  sectors: string[];
  // Screen 2 — required, single
  role: string | null;
  // Screen 3 — required, single
  seniority: string | null;
  // Screen 4 — required, defaults to "standard"
  depthPreference: DepthPreference;
  // Screen 5 — skippable; when the user clicks Skip we fill with every
  // topic from every selected sector (handled at submit time).
  topics: { sector: string; topic: string }[];
  // Screen 6 — skippable; when the user clicks Skip we submit
  // ["stay_current"] per spec.
  goals: string[];
  // Screen 7 — required, single
  digestPreference: DigestPreference | null;
  // Screen 7 — derived client-side on first mount of screen 7 via
  // Intl.DateTimeFormat().resolvedOptions().timeZone; stored here so
  // a back-traversal doesn't force re-detection.
  timezone: string | null;

  // Actions
  setSectors: (sectors: string[]) => void;
  setRole: (role: string) => void;
  setSeniority: (seniority: string) => void;
  setDepthPreference: (depth: DepthPreference) => void;
  setTopics: (topics: { sector: string; topic: string }[]) => void;
  setGoals: (goals: string[]) => void;
  setDigestPreference: (digest: DigestPreference) => void;
  setTimezone: (tz: string) => void;
  reset: () => void;
}

const initialState: Omit<
  OnboardingState,
  | "setSectors"
  | "setRole"
  | "setSeniority"
  | "setDepthPreference"
  | "setTopics"
  | "setGoals"
  | "setDigestPreference"
  | "setTimezone"
  | "reset"
> = {
  sectors: [],
  role: null,
  seniority: null,
  depthPreference: "standard",
  topics: [],
  goals: [],
  digestPreference: null,
  timezone: null,
};

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set) => ({
      ...initialState,
      setSectors: (sectors) => set({ sectors }),
      setRole: (role) => set({ role }),
      setSeniority: (seniority) => set({ seniority }),
      setDepthPreference: (depthPreference) => set({ depthPreference }),
      setTopics: (topics) => set({ topics }),
      setGoals: (goals) => set({ goals }),
      setDigestPreference: (digestPreference) => set({ digestPreference }),
      setTimezone: (timezone) => set({ timezone }),
      reset: () => set({ ...initialState }),
    }),
    {
      name: "signal-onboarding",
      // sessionStorage: survives refresh, dies on tab close / signout.
      storage: createJSONStorage(() => {
        if (typeof window !== "undefined") return window.sessionStorage;
        // SSR fallback — no-op Storage impl satisfying the interface
        // fully so TS accepts it without an unsound cast.
        const noop: Storage = {
          length: 0,
          clear: () => undefined,
          getItem: () => null,
          key: () => null,
          removeItem: () => undefined,
          setItem: () => undefined,
        };
        return noop;
      }),
    },
  ),
);
