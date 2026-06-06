"use client";

import { useEffect, useState } from "react";

// Redesign v2 — the return-tomorrow loop. Tracks when the reader last opened
// the briefing so the feed can greet them with "what's new since you were
// last here", not just a fixed rolling window. This is the habit mechanic:
// the feed remembers your last visit and shows you exactly what you missed.
//
// Persisted in localStorage. The "previous visit" is captured ONCE per page
// load into a module singleton BEFORE the timestamp is advanced, so every
// component in the session (the ranked stream, the originals band) reads the
// same boundary and there is no read/write race between them.
//
// A quick refresh must not reset the boundary to "now" (that would show 0
// new). So the stored timestamp only advances when the gap since the last
// visit exceeds ADVANCE_GAP_MS — a refresh keeps the same "since" boundary;
// a genuine return (≥30 min away) advances it.

const STORAGE_KEY = "signal:lastVisit";
const ADVANCE_GAP_MS = 30 * 60 * 1000;

let sessionPreviousMs: number | null = null;
let initialized = false;

function initOnce(): void {
  if (initialized) return;
  initialized = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const prev = raw != null ? Number(raw) : NaN;
    sessionPreviousMs = Number.isFinite(prev) ? prev : null;
    const now = Date.now();
    if (sessionPreviousMs == null || now - sessionPreviousMs > ADVANCE_GAP_MS) {
      window.localStorage.setItem(STORAGE_KEY, String(now));
    }
  } catch {
    // Private mode / disabled storage — degrade to "first visit" semantics.
    sessionPreviousMs = null;
  }
}

export interface LastVisit {
  /** Ms timestamp of the reader's previous visit, or null on a first visit. */
  previousVisitMs: number | null;
  /** True once the client has read storage (SSR-safe: false during paint). */
  ready: boolean;
}

export function useLastVisit(): LastVisit {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    initOnce();
    setReady(true);
  }, []);
  return { previousVisitMs: ready ? sessionPreviousMs : null, ready };
}
