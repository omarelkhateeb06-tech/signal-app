import { processNativeEnrichment } from "../../src/jobs/ingestion/nativeEnrichmentJob";
import type { NativeEnrichmentDeps } from "../../src/jobs/ingestion/nativeEnrichmentJob";
import { createMockDb, type MockDb } from "../helpers/mockDb";

const CANDIDATE_ID = "11111111-1111-1111-1111-111111111111";

function snapshot(
  overrides: Partial<{ status: string; sector: string | null; bodyText: string | null }> = {},
): Record<string, unknown> {
  return {
    status: "discovered",
    sector: "ai",
    bodyText: "An authored native post body long enough to pass.",
    ...overrides,
  };
}

// Builds the deps bundle with sensible happy-path seam defaults; tests
// override individual seams to exercise failure branches.
function makeDeps(
  mock: MockDb,
  overrides: Partial<NativeEnrichmentDeps> = {},
): NativeEnrichmentDeps {
  return {
    db: mock.db as never,
    runFacts: (async () => ({
      ok: true,
      facts: { facts: [{ text: "a fact about the repo", category: "context" }] },
      raw: { model: "test" },
    })) as never,
    processTier: (async () => ({
      ranTiers: ["accessible", "briefed", "technical"],
      skippedTiers: [],
      failedTier: null,
      completed: true,
    })) as never,
    writeEvent: (async () => ({ eventId: "event-xyz" })) as never,
    captureFailure: jest.fn() as never,
    ...overrides,
  };
}

describe("processNativeEnrichment", () => {
  let mock: MockDb;

  beforeEach(() => {
    mock = createMockDb();
  });

  describe("happy path", () => {
    it("runs facts → tiers → writeEvent and publishes", async () => {
      mock.queueSelect([snapshot()]);
      const deps = makeDeps(mock);
      const result = await processNativeEnrichment({ candidateId: CANDIDATE_ID }, deps);
      expect(result.terminalStatus).toBe("published");
      expect(result.resolvedEventId).toBe("event-xyz");
      expect(result.failureReason).toBeNull();
    });

    it("persists facts_extracted between facts and tiers", async () => {
      mock.queueSelect([snapshot()]);
      await processNativeEnrichment({ candidateId: CANDIDATE_ID }, makeDeps(mock));
      const factsUpdate = mock.state.updatedRows.find(
        (r) => r.status === "facts_extracted",
      );
      expect(factsUpdate).toBeDefined();
    });
  });

  describe("missing candidate", () => {
    it("fails with candidate_not_found when the snapshot is empty", async () => {
      mock.queueSelect([]);
      const result = await processNativeEnrichment(
        { candidateId: CANDIDATE_ID },
        makeDeps(mock),
      );
      expect(result.terminalStatus).toBe("failed");
      expect(result.failureReason).toBe("candidate_not_found");
    });
  });

  describe("terminal short-circuit", () => {
    it.each(["tier_generated", "published", "failed"])(
      "returns immediately for terminal status %s without calling seams",
      async (status) => {
        mock.queueSelect([snapshot({ status })]);
        const runFacts = jest.fn();
        const result = await processNativeEnrichment(
          { candidateId: CANDIDATE_ID },
          makeDeps(mock, { runFacts: runFacts as never }),
        );
        expect(runFacts).not.toHaveBeenCalled();
        expect(result.terminalStatus).toBe(status);
      },
    );
  });

  describe("preconditions", () => {
    it("fails native_invalid_sector when sector is not a valid sector", async () => {
      mock.queueSelect([snapshot({ sector: "biotech" })]);
      const captureFailure = jest.fn();
      const result = await processNativeEnrichment(
        { candidateId: CANDIDATE_ID },
        makeDeps(mock, { captureFailure: captureFailure as never }),
      );
      expect(result.failureReason).toBe("native_invalid_sector");
      expect(captureFailure).toHaveBeenCalledWith(
        expect.objectContaining({ stage: "relevance", rejectionReason: "native_invalid_sector" }),
      );
    });

    it("fails native_invalid_sector when sector is null", async () => {
      mock.queueSelect([snapshot({ sector: null })]);
      const result = await processNativeEnrichment(
        { candidateId: CANDIDATE_ID },
        makeDeps(mock),
      );
      expect(result.failureReason).toBe("native_invalid_sector");
    });

    it("fails native_empty_body when bodyText is blank", async () => {
      mock.queueSelect([snapshot({ bodyText: "   " })]);
      const captureFailure = jest.fn();
      const result = await processNativeEnrichment(
        { candidateId: CANDIDATE_ID },
        makeDeps(mock, { captureFailure: captureFailure as never }),
      );
      expect(result.failureReason).toBe("native_empty_body");
      expect(captureFailure).toHaveBeenCalledWith(
        expect.objectContaining({ stage: "facts", rejectionReason: "native_empty_body" }),
      );
    });
  });

  describe("facts failure", () => {
    it("marks the candidate failed when facts extraction fails", async () => {
      mock.queueSelect([snapshot()]);
      const result = await processNativeEnrichment(
        { candidateId: CANDIDATE_ID },
        makeDeps(mock, {
          runFacts: (async () => ({
            ok: false,
            rejectionReason: "facts_parse_error",
          })) as never,
        }),
      );
      expect(result.terminalStatus).toBe("failed");
      expect(result.failureReason).toBe("facts_parse_error");
    });
  });

  describe("tier failure", () => {
    it("fails on a failedTier and never writes an event", async () => {
      mock.queueSelect([snapshot()]);
      const writeEvent = jest.fn();
      const result = await processNativeEnrichment(
        { candidateId: CANDIDATE_ID },
        makeDeps(mock, {
          processTier: (async () => ({
            ranTiers: ["accessible"],
            skippedTiers: [],
            failedTier: { tier: "briefed", reason: "tier_parse_error" },
            completed: false,
          })) as never,
          writeEvent: writeEvent as never,
        }),
      );
      expect(result.terminalStatus).toBe("failed");
      expect(result.failureReason).toBe("tier_parse_error");
      expect(writeEvent).not.toHaveBeenCalled();
    });

    it("returns facts_extracted (non-terminal) when tiers are indeterminate", async () => {
      mock.queueSelect([snapshot()]);
      const result = await processNativeEnrichment(
        { candidateId: CANDIDATE_ID },
        makeDeps(mock, {
          processTier: (async () => ({
            ranTiers: [],
            skippedTiers: [],
            failedTier: null,
            completed: false,
          })) as never,
        }),
      );
      expect(result.terminalStatus).toBe("facts_extracted");
      expect(result.failureReason).toBeNull();
    });
  });

  describe("writeEvent failure", () => {
    it("captures and fails when writeEvent throws", async () => {
      mock.queueSelect([snapshot()]);
      const captureFailure = jest.fn();
      const result = await processNativeEnrichment(
        { candidateId: CANDIDATE_ID },
        makeDeps(mock, {
          writeEvent: (async () => {
            throw new Error("db down");
          }) as never,
          captureFailure: captureFailure as never,
        }),
      );
      expect(result.terminalStatus).toBe("failed");
      expect(result.failureReason).toContain("write_event_error");
      expect(captureFailure).toHaveBeenCalledWith(
        expect.objectContaining({ stage: "write_event" }),
      );
    });
  });
});
