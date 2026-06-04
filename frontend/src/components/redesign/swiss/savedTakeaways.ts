"use client";

import { useSyncExternalStore } from "react";

// Client-only "saved takeaways" store. Lets a reader bookmark individual
// key-takeaway bullets so the briefing is a working tool, not just a
// reading surface (advisory-board active-engagement item). Persisted to
// localStorage and shared across components via useSyncExternalStore, so
// the same takeaway shows saved in both the left exhibit and the right
// detail panel. There is no backend endpoint for this (and the backend is
// out of scope), so localStorage is the correct home.

const STORAGE_KEY = "signal:saved-takeaways";
const listeners = new Set<() => void>();
let store: Set<string> = new Set();

if (typeof window !== "undefined") {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) store = new Set<string>(JSON.parse(raw) as string[]);
  } catch {
    store = new Set();
  }
}

// Stable empty snapshot for SSR — server has no localStorage, so it always
// renders the unsaved state and the client reconciles on hydration.
const EMPTY_SNAPSHOT: Set<string> = new Set();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): Set<string> {
  return store;
}

function getServerSnapshot(): Set<string> {
  return EMPTY_SNAPSHOT;
}

/** Stable per-bullet key: a story id plus the takeaway's index. */
export function takeawayKey(storyId: string, index: number): string {
  return `${storyId}::${index}`;
}

export function toggleSavedTakeaway(key: string): void {
  const next = new Set(store);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  store = next;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...store]));
    } catch {
      /* ignore quota / disabled storage */
    }
  }
  listeners.forEach((l) => l());
}

export function useSavedTakeaways(): Set<string> {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
