/* eslint-disable @typescript-eslint/no-explicit-any */
import { createMockDb, type MockDb } from "../helpers/mockDb";
import type { AdapterFn, AdapterResult, Candidate } from "../../src/jobs/ingestion/types";

// Mock the db module so processSourcePollJob picks up our mock.
let mock: MockDb;
jest.mock("../../src/db", () => ({
  get db() {
    return mock.db;
  },
}));

// Mock the adapter registry. Tests inject behavior per test via the
// `currentAdapter` slot.
let currentAdapter: AdapterFn | null = null;
jest.mock("../../src/jobs/ingestion/adapters", () => ({
  getAdapter: () => currentAdapter,
}));

// Import after mocks so the module bindings resolve to the mocked db/registry.
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const { processSourcePollJob } = require("../../src/jobs/ingestion/sourcePollJob");

const SOURCE_ROW = {
  id: "00000000-0000-0000-0000-000000000001",
  slug: "import-ai",
  adapterType: "rss",
  endpoint: "https://importai.substack.com/feed",
  config: {},
  lastPolledAt: null,
  consecutiveFailureCount: 0,
};

function makeCandidate(externalId: string): Candidate {
  return {
    externalId,
    url: "https://example.com/article-" + externalId,
    title: "Title " + externalId,
    summary: "Summary " + externalId,
    publishedAt: new Date("2026-04-27T12:00:00Z"),
    contentHash: "a".repeat(32),
    rawPayload: { id: externalId },
  };
}

beforeEach(() => {
  mock = createMockDb();
  currentAdapter = null;
});

describe("processSourcePollJob", () => {
  describe("source not found", () => {
    it("throws when the source row is missing", async () => {
      mock.queueSelect([]); // SELECT returns empty
      await expect(
        processSourcePollJob({ sourceId: "missing" }),
      ).rejects.toThrow("source not found: missing");
      expect(mock.state.updatedRows.length).toBe(0);
    });
  });

  describe("adapter slot null", () => {
    it("returns no-op result with adapter_not_implemented", async () => {
      mock.queueSelect([SOURCE_ROW]);
      currentAdapter = null;
      const result = await processSourcePollJob({ sourceId: SOURCE_ROW.id });
      expect(result).toEqual({
        sourceId: SOURCE_ROW.id,
        candidatesDiscovered: 0,
        candidatesPersisted: 0,
        failureReason: "adapter_not_implemented",
      });
      // No updates touched the source row.
      expect(mock.state.updatedRows.length).toBe(0);
    });
  });

  describe("happy path", () => {
    it("persists candidates, resets counter, sets lastPolledAt", async () => {
      const candidates = [makeCandidate("a"), makeCandidate("b"), makeCandidate("c")];
      mock.queueSelect([SOURCE_ROW]);
      // Insert returning array — pretend all 3 inserted.
      mock.queueInsert([{ id: "1" }, { id: "2" }, { id: "3" }]);
      currentAdapter = jest.fn(
        async (): Promise<AdapterResult> => ({ candidates }),
      );

      const result = await processSourcePollJob({ sourceId: SOURCE_ROW.id });

      expect(result).toEqual({
        sourceId: SOURCE_ROW.id,
        candidatesDiscovered: 3,
        candidatesPersisted: 3,
        failureReason: null,
      });
      // Exactly one source-row update — the markSuccess.
      expect(mock.state.updatedRows.length).toBe(1);
      expect(mock.state.updatedRows[0]!.consecutiveFailureCount).toBe(0);
      expect(mock.state.updatedRows[0]!.lastPolledAt).toBeInstanceOf(Date);
    });

    it("counts conflict-skipped rows as not-persisted", async () => {
      const candidates = [makeCandidate("a"), makeCandidate("b")];
      mock.queueSelect([SOURCE_ROW]);
      // Insert returning array — only 1 of 2 actually inserted (the other
      // hit the unique constraint and was skipped by onConflictDoNothing).
      mock.queueInsert([{ id: "1" }]);
      currentAdapter = async (): Promise<AdapterResult> => ({ candidates });

      const result = await processSourcePollJob({ sourceId: SOURCE_ROW.id });

      expect(result.candidatesDiscovered).toBe(2);
      expect(result.candidatesPersisted).toBe(1);
      expect(result.failureReason).toBeNull();
    });

    it("handles zero-candidate result without insert call", async () => {
      mock.queueSelect([SOURCE_ROW]);
      currentAdapter = async (): Promise<AdapterResult> => ({ candidates: [] });

      const result = await processSourcePollJob({ sourceId: SOURCE_ROW.id });

      expect(result.candidatesDiscovered).toBe(0);
      expect(result.candidatesPersisted).toBe(0);
      expect(result.failureReason).toBeNull();
    });
  });

  describe("adapter throw → mark failure, no rethrow", () => {
    it.each([
      ["http_4xx"],
      ["http_5xx"],
      ["timeout"],
      ["wrong_content_type"],
      ["parse_error"],
      ["network"],
    ])("captures %s without rethrowing", async (reason) => {
      mock.queueSelect([SOURCE_ROW]);
      currentAdapter = async () => {
        throw new Error(reason);
      };

      const result = await processSourcePollJob({ sourceId: SOURCE_ROW.id });

      expect(result.failureReason).toBe(reason);
      expect(result.candidatesDiscovered).toBe(0);
      expect(result.candidatesPersisted).toBe(0);
      // markFailure ran exactly once.
      expect(mock.state.updatedRows.length).toBe(1);
      const update = mock.state.updatedRows[0];
      // The increment is expressed as a sql`...` expression; we can't
      // easily inspect its value here, but we can check the field is set.
      expect(update.consecutiveFailureCount).toBeDefined();
      expect(update.lastPolledAt).toBeInstanceOf(Date);
    });

    it("falls back to 'network' when error is not an Error instance", async () => {
      mock.queueSelect([SOURCE_ROW]);
      currentAdapter = async () => {
        throw "string-throw"; // eslint-disable-line @typescript-eslint/only-throw-error
      };
      const result = await processSourcePollJob({ sourceId: SOURCE_ROW.id });
      expect(result.failureReason).toBe("network");
    });
  });
});
