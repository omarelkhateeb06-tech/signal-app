"use client";

import { useSyncExternalStore } from "react";

// Client-only "read / done" state for the ranked stream, turning the index
// into a worklist: a reader can check off the stories they've worked
// through. Persisted to localStorage and shared across components via
// useSyncExternalStore (same pattern as savedTakeaways). No backend — the
// worklist is a per-browser convenience, fail-open if storage is blocked.

const STORAGE_KEY = "signal:read-stories";
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

function persist(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...store]));
  } catch {
    /* ignore quota / disabled storage */
  }
}

export function toggleStoryRead(storyId: string): void {
  const next = new Set(store);
  if (next.has(storyId)) next.delete(storyId);
  else next.add(storyId);
  store = next;
  persist();
  listeners.forEach((l) => l());
}

/** Mark read without toggling — used when a story is opened to read. */
export function markStoryRead(storyId: string): void {
  if (store.has(storyId)) return;
  const next = new Set(store);
  next.add(storyId);
  store = next;
  persist();
  listeners.forEach((l) => l());
}

export function useReadStories(): Set<string> {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
