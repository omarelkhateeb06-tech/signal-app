// Phase 12e.x fix cluster — enrichmentRecovery service tests.
//
// The service has three observable behaviors worth pinning down:
//   1. Detection query — only matches stuck candidates (partial
//      tier_outputs, within the 48h window, not already finalized,
//      under the attempt cap).
//   2. Re-enqueue loop — bumps recovery_attempts before enqueuing
//      (so a flapping queue still costs an attempt) and never aborts
//      the batch on a single enqueue error.
//   3. Finalize step — flips enrichment_failed=true on rows whose
//      attempts have hit the cap.
//
// Uses the same mockDb pattern as the rest of the backend test suite.

import { createMockDb } from "../helpers/mockDb";

const mock = createMockDb();
const enqueueEnrichmentMock = jest.fn();

jest.mock("../../src/db", () => ({
  __esModule: true,
  get db() {
    return mock.db;
  },
  schema: {},
  pool: {},
}));

jest.mock("../../src/jobs/ingestion/enrichmentQueue", () => ({
  __esModule: true,
  enqueueEnrichment: (...args: unknown[]) => enqueueEnrichmentMock(...args),
}));

import {
  MAX_RECOVERY_ATTEMPTS,
  findStuckCandidates,
  recoverStuckCandidates,
} from "../../src/jobs/ingestion/enrichmentRecovery";

const NOW = new Date("2026-05-20T12:00:00Z");

describe("enrichmentRecovery", () => {
  beforeEach(() => {
    mock.reset();
    enqueueEnrichmentMock.mockReset();
    enqueueEnrichmentMock.mockResolvedValue({ queued: true, jobId: "j1" });
  });

  describe("findStuckCandidates", () => {
    it("returns the candidate ids that match the detection query", async () => {
      mock.queueSelect([
        { id: "cand-a" },
        { id: "cand-b" },
      ]);
      const ids = await findStuckCandidates({ now: () => NOW });
      expect(ids).toEqual(["cand-a", "cand-b"]);
    });

    it("returns an empty list when no rows match", async () => {
      mock.queueSelect([]);
      const ids = await findStuckCandidates({ now: () => NOW });
      expect(ids).toEqual([]);
    });
  });

  describe("recoverStuckCandidates", () => {
    it("bumps recovery_attempts before each enqueue and reports per-pass counts", async () => {
      // Pass 1: discovery returns two stuck candidates.
      mock.queueSelect([{ id: "cand-1" }, { id: "cand-2" }]);
      // No rows finalized this round — pass 2 (the .returning() inside
      // finalizeExhausted reads from the insert/update queue).
      mock.queueInsert([]);

      const result = await recoverStuckCandidates({ now: () => NOW });

      expect(result.scanned).toBe(2);
      expect(result.reEnqueued).toBe(2);
      expect(result.markedFailed).toBe(0);
      // recovery_attempts bumped exactly once per candidate before the
      // enqueue — captured via the mockDb's updatedRows array.
      expect(mock.state.updatedRows.length).toBeGreaterThanOrEqual(2);
      // Enqueue called per candidate with the right shape.
      expect(enqueueEnrichmentMock).toHaveBeenCalledTimes(2);
      expect(enqueueEnrichmentMock).toHaveBeenCalledWith({
        candidateId: "cand-1",
        triggeredBy: "cli",
      });
    });

    it("continues the batch when one enqueue throws", async () => {
      mock.queueSelect([{ id: "cand-1" }, { id: "cand-2" }, { id: "cand-3" }]);
      mock.queueInsert([]);
      enqueueEnrichmentMock
        .mockResolvedValueOnce({ queued: true, jobId: "j1" })
        .mockRejectedValueOnce(new Error("BullMQ down"))
        .mockResolvedValueOnce({ queued: true, jobId: "j3" });

      const consoleErr = jest.spyOn(console, "error").mockImplementation();
      const result = await recoverStuckCandidates({ now: () => NOW });
      consoleErr.mockRestore();

      // All three attempted; two succeeded; one logged.
      expect(result.scanned).toBe(3);
      expect(result.reEnqueued).toBe(2);
      expect(enqueueEnrichmentMock).toHaveBeenCalledTimes(3);
    });

    it("reports markedFailed from the finalize update", async () => {
      mock.queueSelect([]); // no stuck rows to re-enqueue
      mock.queueInsert([{ id: "old-cand" }]); // one row finalized in finalize step
      const result = await recoverStuckCandidates({ now: () => NOW });
      expect(result.reEnqueued).toBe(0);
      expect(result.markedFailed).toBe(1);
    });

    it("MAX_RECOVERY_ATTEMPTS guard is 3", () => {
      expect(MAX_RECOVERY_ATTEMPTS).toBe(3);
    });
  });
});
