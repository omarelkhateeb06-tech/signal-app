/* eslint-disable @typescript-eslint/no-explicit-any */
import { createMockDb, type MockDb } from "../helpers/mockDb";
import { scheduleSourcePollRepeatable } from "../../src/jobs/ingestion/sourcePollQueue";

let mock: MockDb;
let queueAddCalls: Array<{ name: string; data: any; opts: any }>;
let mockQueue: any;

beforeEach(() => {
  mock = createMockDb();
  queueAddCalls = [];
  mockQueue = {
    add: jest.fn((name: string, data: any, opts: any) => {
      queueAddCalls.push({ name, data, opts });
      return Promise.resolve({ id: `job-${queueAddCalls.length}` });
    }),
  };
});

describe("scheduleSourcePollRepeatable", () => {
  it("creates one repeatable job per enabled source with the source's cadence", async () => {
    mock.queueSelect([
      {
        id: "src-1",
        slug: "cnbc-markets",
        enabled: true,
        fetchIntervalSeconds: 1800, // 30 min
      },
      {
        id: "src-2",
        slug: "import-ai",
        enabled: true,
        fetchIntervalSeconds: 86400, // 24 hr
      },
      {
        id: "src-3",
        slug: "bloomberg-markets",
        enabled: true,
        fetchIntervalSeconds: 600, // 10 min
      },
    ]);

    const result = await scheduleSourcePollRepeatable({
      db: mock.db,
      queue: mockQueue,
    });

    expect(result.scheduled).toBe(3);
    expect(result.skipped).toBe(0);
    expect(queueAddCalls).toHaveLength(3);

    const calls = Object.fromEntries(
      queueAddCalls.map((c) => [c.opts.jobId, c]),
    );

    expect(calls["repeat:poll:cnbc-markets"].opts.repeat.every).toBe(
      1800 * 1000,
    );
    expect(calls["repeat:poll:cnbc-markets"].data).toEqual({
      sourceId: "src-1",
      triggeredBy: "cron",
    });

    expect(calls["repeat:poll:import-ai"].opts.repeat.every).toBe(86400 * 1000);
    expect(calls["repeat:poll:import-ai"].data).toEqual({
      sourceId: "src-2",
      triggeredBy: "cron",
    });

    expect(calls["repeat:poll:bloomberg-markets"].opts.repeat.every).toBe(
      600 * 1000,
    );
  });

  it("skips disabled sources", async () => {
    mock.queueSelect([
      {
        id: "src-1",
        slug: "active",
        enabled: true,
        fetchIntervalSeconds: 1800,
      },
      {
        id: "src-2",
        slug: "disabled",
        enabled: false,
        fetchIntervalSeconds: 1800,
      },
    ]);

    const result = await scheduleSourcePollRepeatable({
      db: mock.db,
      queue: mockQueue,
    });

    expect(result.scheduled).toBe(1);
    expect(result.skipped).toBe(1);
    expect(queueAddCalls).toHaveLength(1);
    expect(queueAddCalls[0].opts.jobId).toBe("repeat:poll:active");
  });

  it("skips sources with null or non-positive fetch_interval_seconds (defensive)", async () => {
    // Schema declares fetchIntervalSeconds NOT NULL with default 1800, so
    // these cases shouldn't fire in production — but the guard prevents
    // a degenerate `every: 0` schedule if the constraint is ever relaxed.
    mock.queueSelect([
      {
        id: "src-1",
        slug: "ok",
        enabled: true,
        fetchIntervalSeconds: 1800,
      },
      {
        id: "src-2",
        slug: "null-interval",
        enabled: true,
        fetchIntervalSeconds: null,
      },
      {
        id: "src-3",
        slug: "zero-interval",
        enabled: true,
        fetchIntervalSeconds: 0,
      },
      {
        id: "src-4",
        slug: "negative-interval",
        enabled: true,
        fetchIntervalSeconds: -60,
      },
    ]);

    const result = await scheduleSourcePollRepeatable({
      db: mock.db,
      queue: mockQueue,
    });

    expect(result.scheduled).toBe(1);
    expect(result.skipped).toBe(3);
    expect(queueAddCalls).toHaveLength(1);
    expect(queueAddCalls[0].opts.jobId).toBe("repeat:poll:ok");
  });

  it("attaches removeOnComplete + removeOnFail to the repeatable job opts", async () => {
    mock.queueSelect([
      { id: "src-1", slug: "one", enabled: true, fetchIntervalSeconds: 60 },
    ]);
    await scheduleSourcePollRepeatable({ db: mock.db, queue: mockQueue });
    const opts = queueAddCalls[0].opts;
    expect(opts.removeOnComplete).toEqual({ age: 86_400, count: 500 });
    expect(opts.removeOnFail).toEqual({ age: 604_800 });
  });

  it("returns {scheduled: 0, skipped: 0} when queue is unavailable (Redis unset)", async () => {
    // Don't queue any select; queue=null short-circuits before the select.
    const warn = jest
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const result = await scheduleSourcePollRepeatable({
      db: mock.db,
      queue: null,
    });
    expect(result).toEqual({ scheduled: 0, skipped: 0 });
    expect(queueAddCalls).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("returns {scheduled: 0, skipped: 0} when no sources exist", async () => {
    mock.queueSelect([]);
    const result = await scheduleSourcePollRepeatable({
      db: mock.db,
      queue: mockQueue,
    });
    expect(result).toEqual({ scheduled: 0, skipped: 0 });
    expect(queueAddCalls).toHaveLength(0);
  });
});
