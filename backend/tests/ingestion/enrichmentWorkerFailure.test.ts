/* eslint-disable @typescript-eslint/no-explicit-any */
import { createMockDb, type MockDb } from "../helpers/mockDb";
import { handleWorkerFailure } from "../../src/jobs/ingestion/enrichmentWorkerFailure";

const CANDIDATE_ID = "00000000-0000-0000-0000-0000000000cc";

let mock: MockDb;

beforeEach(() => {
  mock = createMockDb();
});

function fakeJob(
  data: { candidateId?: string } = {},
  attemptsMade = 0,
): any {
  return {
    data: { candidateId: data.candidateId ?? CANDIDATE_ID },
    attemptsMade,
  };
}

describe("handleWorkerFailure (12e.5c sub-step 7)", () => {
  it("captures to Sentry with worker_failed stage + canonical tags + bullmq extras", async () => {
    mock.queueSelect([{ slug: "cnbc-markets" }]); // sourceSlug lookup
    const captureFailure = jest.fn();
    const err = new Error("Worker boom");
    await handleWorkerFailure(fakeJob({}, 1), err, {
      db: mock.db,
      captureFailure,
    });
    expect(captureFailure).toHaveBeenCalledTimes(1);
    expect(captureFailure).toHaveBeenCalledWith({
      stage: "worker_failed",
      candidateId: CANDIDATE_ID,
      sourceSlug: "cnbc-markets",
      rejectionReason: "Worker boom",
      err,
      extraTags: {
        "bullmq.attempt": "1",
        "bullmq.queue": "signal-ingestion-enrich",
      },
    });
  });

  it("propagates the original Error object to capture (preserves stack)", async () => {
    mock.queueSelect([{ slug: "import-ai" }]);
    const captureFailure = jest.fn();
    const err = new Error("typed boom");
    await handleWorkerFailure(fakeJob({}, 0), err, {
      db: mock.db,
      captureFailure,
    });
    const call = captureFailure.mock.calls[0][0];
    expect(call.err).toBe(err);
  });

  it("handles undefined job (BullMQ may pass undefined for orphaned failures)", async () => {
    const captureFailure = jest.fn();
    const err = new Error("orphan");
    await handleWorkerFailure(undefined, err, {
      db: mock.db,
      captureFailure,
    });
    expect(captureFailure).toHaveBeenCalledTimes(1);
    const call = captureFailure.mock.calls[0][0];
    expect(call.candidateId).toBe("unknown");
    expect(call.sourceSlug).toBeNull();
    expect(call.extraTags["bullmq.attempt"]).toBe("0");
  });

  it("uses 'unknown_error' fallback when err.message is empty", async () => {
    mock.queueSelect([{ slug: "src-1" }]);
    const captureFailure = jest.fn();
    const err = new Error("");
    await handleWorkerFailure(fakeJob({}, 0), err, {
      db: mock.db,
      captureFailure,
    });
    const call = captureFailure.mock.calls[0][0];
    expect(call.rejectionReason).toBe("unknown_error");
  });

  it("captures with sourceSlug=null when source lookup returns no rows", async () => {
    // Empty select result.
    mock.queueSelect([]);
    const captureFailure = jest.fn();
    const err = new Error("boom");
    await handleWorkerFailure(fakeJob({}, 0), err, {
      db: mock.db,
      captureFailure,
    });
    const call = captureFailure.mock.calls[0][0];
    expect(call.sourceSlug).toBeNull();
    // Capture still fires.
    expect(captureFailure).toHaveBeenCalledTimes(1);
  });

  it("captures with sourceSlug=null when DB lookup throws (best-effort, no compounded failure)", async () => {
    const captureFailure = jest.fn();
    const err = new Error("orig");
    // Override db.select to throw.
    const throwingDb = {
      select: () => {
        throw new Error("DB lookup blew up mid-failure handler");
      },
    } as any;
    await handleWorkerFailure(fakeJob({}, 2), err, {
      db: throwingDb,
      captureFailure,
    });
    // Capture still fires with the ORIGINAL error (not the lookup error).
    expect(captureFailure).toHaveBeenCalledTimes(1);
    const call = captureFailure.mock.calls[0][0];
    expect(call.err).toBe(err);
    expect(call.rejectionReason).toBe("orig");
    expect(call.sourceSlug).toBeNull();
    expect(call.extraTags["bullmq.attempt"]).toBe("2");
  });

  it("emits the existing console.error log line (preserves observability)", async () => {
    mock.queueSelect([{ slug: "src" }]);
    const captureFailure = jest.fn();
    const errSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const err = new Error("logged-error");
    await handleWorkerFailure(fakeJob({}, 0), err, {
      db: mock.db,
      captureFailure,
    });
    expect(errSpy).toHaveBeenCalled();
    const logged = errSpy.mock.calls[0][0] as string;
    expect(logged).toContain("[ingestion-enrich:failed]");
    expect(logged).toContain(CANDIDATE_ID);
    expect(logged).toContain("logged-error");
    errSpy.mockRestore();
  });
});
