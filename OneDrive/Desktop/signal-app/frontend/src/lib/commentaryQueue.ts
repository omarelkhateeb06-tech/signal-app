// Phase 12c — module-local semaphore that caps in-flight commentary
// fetches. The client can have many StoryCard mounts all with
// `enabled=true` at once (think: user scrolls to the bottom of a
// 50-story feed); without a cap we would fan out 50 parallel requests
// to a Haiku-backed endpoint.
//
// Why 8: the feed route serves 10 stories per page, so 8 slots lets
// the first page's requests run in two back-to-back waves rather than
// one wave of 10 (which saturates every browser's per-origin parallel
// HTTP cap of 6 and then stalls) — and Haiku itself doesn't like 50
// fanouts either. The number is a deliberate product decision, not
// browser-imposed: it's the cap _above_ the browser cap, shaping
// queue pressure on the server.
//
// The 5-story scroll-ahead prefetch mechanic lives in the feed page —
// cards only become `enabled` as they enter a ~5-row lookahead window
// of the viewport. This module is the concurrency gate behind that
// enablement.
//
// Revisit in 12c.1 if instrumentation says queue wait is >100ms P95.

const MAX_CONCURRENT = 8;

let active = 0;
const waiters: Array<() => void> = [];

function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active += 1;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    waiters.push(() => {
      active += 1;
      resolve();
    });
  });
}

function release(): void {
  active -= 1;
  const next = waiters.shift();
  if (next) next();
}

/**
 * Wraps a fetch so it only runs when a semaphore slot is available.
 * Never rejects on its own; forwards the wrapped function's result
 * (resolve or reject) verbatim and always releases its slot.
 */
export async function withCommentarySlot<T>(fn: () => Promise<T>): Promise<T> {
  await acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}

// Exported for tests — lets a test suite reset the module singleton
// between cases so a throw in one case doesn't leak into the next.
export function __resetCommentaryQueueForTests(): void {
  active = 0;
  waiters.length = 0;
}

// Exported for tests + potential future telemetry. Do NOT use from
// product code to gate behavior — read it once and the value is
// already stale.
export function __commentaryQueueSnapshot(): { active: number; waiting: number } {
  return { active, waiting: waiters.length };
}

export const COMMENTARY_MAX_CONCURRENT = MAX_CONCURRENT;
