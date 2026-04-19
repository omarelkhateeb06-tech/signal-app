"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

interface TeamsState {
  activeTeamId: string | null;
  hasHydrated: boolean;
  setActiveTeam: (id: string | null) => void;
  clear: () => void;
  setHasHydrated: (value: boolean) => void;
}

export const useTeamsStore = create<TeamsState>()(
  persist(
    (set) => ({
      activeTeamId: null,
      hasHydrated: false,
      setActiveTeam: (id) => set({ activeTeamId: id }),
      clear: () => set({ activeTeamId: null }),
      setHasHydrated: (value) => set({ hasHydrated: value }),
    }),
    {
      name: "signal-teams",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ activeTeamId: state.activeTeamId }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);
