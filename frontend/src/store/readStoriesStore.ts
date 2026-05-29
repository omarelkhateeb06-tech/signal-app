"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

interface ReadStoriesState {
  readIds: string[];
  markRead: (id: string) => void;
  isRead: (id: string) => boolean;
}

const noopStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

export const useReadStoriesStore = create<ReadStoriesState>()(
  persist(
    (set, get) => ({
      readIds: [],
      markRead: (id: string) => {
        if (!get().readIds.includes(id)) {
          set((state) => ({ readIds: [...state.readIds, id] }));
        }
      },
      isRead: (id: string) => get().readIds.includes(id),
    }),
    {
      name: "valo_read_stories",
      storage: createJSONStorage(() =>
        typeof window !== "undefined" ? localStorage : noopStorage,
      ),
      partialize: (state) => ({ readIds: state.readIds }),
    },
  ),
);
