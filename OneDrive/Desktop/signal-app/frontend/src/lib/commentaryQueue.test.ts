import { beforeEach, describe, expect, it } from "vitest";
import {
  COMMENTARY_MAX_CONCURRENT,
  __commentaryQueueSnapshot,
  __resetCommentaryQueueForTests,
  withCommentarySlot,
} from "./commentaryQueue";

// Deferred-promise helper — callers can independently kick off a
// batch of pending fetches and resolve them one at a time to prove
// the semaphore is actually admitting work in order as slots free.
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Flush all pending microtasks. Resolving a deferred triggers a chain
// (release → waiter resolve → awaiter continuation → fn() body), and
// a single `await Promise.resolve()` only walks one step of that
// chain. Using setTimeout(0) jumps to the next macrotask, which
// guarantees all microtasks (including nested ones) have drained.
function flushMicrotasks(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

describe("commentaryQueue — withCommentarySlot", () => {
  beforeEach(() => {
    __resetCommentaryQueueForTests();
  });

  it("runs a single task inline without queueing", async () => {
    const result = await withCommentarySlot(() => Promise.resolve("ok"));
    expect(result).toBe("ok");
    // Post-resolution, active must return to zero — otherwise a
    // subsequent batch could permanently lose a slot.
    expect(__commentaryQueueSnapshot()).toEqual({ active: 0, waiting: 0 });
  });

  it("admits at most COMMENTARY_MAX_CONCURRENT tasks at once", async () => {
    const deferreds = Array.from({ length: COMMENTARY_MAX_CONCURRENT + 4 }, () =>
      deferred<string>(),
    );
    const results: Array<Promise<string>> = deferreds.map((d, i) =>
      withCommentarySlot(() => d.promise.then((v) => `${v}-${i}`)),
    );

    // Let the event loop run once so the queue can admit the first
    // wave — without this, active is still 0 because withCommentarySlot's
    // body hasn't progressed past `await acquire()` yet.
    await Promise.resolve();

    const snap = __commentaryQueueSnapshot();
    expect(snap.active).toBe(COMMENTARY_MAX_CONCURRENT);
    expect(snap.waiting).toBe(4);

    // Resolve the first wave; queued tasks should start admitting.
    for (let i = 0; i < COMMENTARY_MAX_CONCURRENT; i += 1) {
      deferreds[i].resolve("done");
    }
    // Resolve the overflow too.
    for (let i = COMMENTARY_MAX_CONCURRENT; i < deferreds.length; i += 1) {
      deferreds[i].resolve("done");
    }

    const resolved = await Promise.all(results);
    expect(resolved).toHaveLength(COMMENTARY_MAX_CONCURRENT + 4);
    expect(__commentaryQueueSnapshot()).toEqual({ active: 0, waiting: 0 });
  });

  it("releases the slot even when the wrapped task throws", async () => {
    await expect(
      withCommentarySlot<string>(() => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");
    expect(__commentaryQueueSnapshot()).toEqual({ active: 0, waiting: 0 });

    // And a subsequent task gets the slot back — proving we didn't
    // leak it on the throw path.
    const second = await withCommentarySlot(() => Promise.resolve("next"));
    expect(second).toBe("next");
  });

  it("admits queued tasks in FIFO order as slots free", async () => {
    const order: number[] = [];
    const deferreds = Array.from({ length: COMMENTARY_MAX_CONCURRENT + 3 }, () =>
      deferred<void>(),
    );
    const all = deferreds.map((d, i) =>
      withCommentarySlot(async () => {
        order.push(i);
        await d.promise;
      }),
    );

    await flushMicrotasks();
    // First wave should have already pushed indices 0..MAX-1 into `order`.
    expect(order).toEqual(
      Array.from({ length: COMMENTARY_MAX_CONCURRENT }, (_, i) => i),
    );

    // Free one slot — the next queued task (index MAX) should admit.
    deferreds[0].resolve();
    await flushMicrotasks();
    expect(order[COMMENTARY_MAX_CONCURRENT]).toBe(COMMENTARY_MAX_CONCURRENT);

    // Free two more and make sure the next two queued tasks admit in
    // the same order they were enqueued.
    deferreds[1].resolve();
    await flushMicrotasks();
    deferreds[2].resolve();
    await flushMicrotasks();
    expect(order[COMMENTARY_MAX_CONCURRENT + 1]).toBe(COMMENTARY_MAX_CONCURRENT + 1);
    expect(order[COMMENTARY_MAX_CONCURRENT + 2]).toBe(COMMENTARY_MAX_CONCURRENT + 2);

    // Drain the rest.
    for (const d of deferreds) d.resolve();
    await Promise.all(all);
    expect(__commentaryQueueSnapshot()).toEqual({ active: 0, waiting: 0 });
  });
});
