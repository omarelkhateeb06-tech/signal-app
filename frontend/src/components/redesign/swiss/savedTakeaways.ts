"use client";

import { useSyncExternalStore } from "react";

// Client-only "saved takeaways" store. Lets a reader bookmark individual
// key-takeaway bullets so the briefing is a working tool, not just a
// reading surface (advisory-board active-engagement item). Each saved
// entry keeps its text and source story so the right panel can give the
// saved set a home (a count + list in the profile sidebar). Persisted to
// localStorage and shared across components via useSyncExternalStore.
// There is no backend endpoint for this (and the backend is out of scope),
// so localStorage is the correct home.

export interface SavedTakeaway {
  key: string;
  storyId: string;
  text: string;
}

const STORAGE_KEY = "signal:saved-takeaways";
const listeners = new Set<() => void>();
let store: Map<string, SavedTakeaway> = new Map();

function hydrate(): Map<string, SavedTakeaway> {
  const map = new Map<string, SavedTakeaway>();
  if (typeof window === "undefined") return map;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as SavedTakeaway[];
      for (const entry of parsed) {
        if (entry && typeof entry.key === "string") map.set(entry.key, entry);
      }
    }
  } catch {
    /* ignore malformed / disabled storage */
  }
  return map;
}

store = hydrate();

// Stable empty snapshot for SSR — the server has no localStorage, so it
// renders the unsaved state and the client reconciles on hydration.
const EMPTY_SNAPSHOT: Map<string, SavedTakeaway> = new Map();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): Map<string, SavedTakeaway> {
  return store;
}

function getServerSnapshot(): Map<string, SavedTakeaway> {
  return EMPTY_SNAPSHOT;
}

/** Stable per-bullet key: a story id plus the takeaway's index. */
export function takeawayKey(storyId: string, index: number): string {
  return `${storyId}::${index}`;
}

export function toggleSavedTakeaway(entry: SavedTakeaway): void {
  const next = new Map(store);
  if (next.has(entry.key)) next.delete(entry.key);
  else next.set(entry.key, entry);
  store = next;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify([...store.values()]),
      );
    } catch {
      /* ignore quota / disabled storage */
    }
  }
  listeners.forEach((l) => l());
}

export function useSavedTakeaways(): Map<string, SavedTakeaway> {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
