// Issue #64 — stuck-candidate recovery sweep.
import { createMockDb } from "./helpers/mockDb";

const mock = createMockDb();

jest.mock("../src/db", () => ({
  __esModule: true,
  get db() {
    return mock.db;
  },
  pool: { end: () => Promise.resolve() },
  schema: {},
}));

import { retryStuckEvents } from "../src/scripts/retryStuckEvents";

describe("retryStuckEvents", () => {
  beforeEach(() => {
    mock.reset();
  });

  it("dry-run reports the stuck count without retrying", async () => {
    mock.queueSelect([{ id: "c1" }, { id: "c2" }]);
    const writeEvent = jest.fn();

    const r = await retryStuckEvents({ apply: false, writeEvent });

    expect(r.found).toBe(2);
    expect(r.retried).toBe(0);
    expect(writeEvent).not.toHaveBeenCalled();
  });

  it("--apply re-attempts writeEvent for each stuck candidate", async () => {
    mock.queueSelect([{ id: "c1" }, { id: "c2" }]);
    const writeEvent = jest.fn().mockResolvedValue({ eventId: "e" });

    const r = await retryStuckEvents({ apply: true, writeEvent });

    expect(r.recovered).toBe(2);
    expect(r.failed).toBe(0);
    expect(writeEvent).toHaveBeenCalledTimes(2);
    expect(writeEvent).toHaveBeenCalledWith("c1", expect.any(Object));
  });

  it("collects per-candidate failures without aborting the sweep", async () => {
    mock.queueSelect([{ id: "c1" }, { id: "c2" }]);
    const writeEvent = jest
      .fn()
      .mockResolvedValueOnce({ eventId: "e1" })
      .mockRejectedValueOnce(new Error("pg connection reset"));

    const r = await retryStuckEvents({ apply: true, writeEvent });

    expect(r.recovered).toBe(1);
    expect(r.failed).toBe(1);
    expect(r.failures[0]?.reason).toContain("pg connection reset");
  });

  it("reports zero when nothing is stuck", async () => {
    mock.queueSelect([]);
    const r = await retryStuckEvents({ apply: true, writeEvent: jest.fn() });
    expect(r.found).toBe(0);
    expect(r.recovered).toBe(0);
  });
});
