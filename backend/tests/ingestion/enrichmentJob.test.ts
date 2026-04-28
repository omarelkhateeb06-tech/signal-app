/* eslint-disable @typescript-eslint/no-explicit-any */
import { createMockDb, type MockDb } from "../helpers/mockDb";
import { HEURISTIC_REASONS } from "../../src/jobs/ingestion/heuristics";
import {
  processEnrichmentJob,
  type EnrichmentSeams,
} from "../../src/jobs/ingestion/enrichmentJob";

const CANDIDATE_ID = "00000000-0000-0000-0000-0000000000cc";

let mock: MockDb;

beforeEach(() => {
  mock = createMockDb();
});

describe("processEnrichmentJob", () => {
  describe("missing seam guard", () => {
    it("returns terminalStatus=failed when runHeuristic seam not provided", async () => {
      const result = await processEnrichmentJob(
        { candidateId: CANDIDATE_ID },
        { db: mock.db, seams: {} },
      );
      expect(result.terminalStatus).toBe("failed");
      expect(result.failureReason).toBe("runHeuristic seam not provided");
      // No DB writes.
      expect(mock.state.updatedRows.length).toBe(0);
    });
  });

  describe("heuristic reject path", () => {
    it("writes status=heuristic_filtered + statusReason on reject", async () => {
      const seams: EnrichmentSeams = {
        runHeuristic: jest.fn().mockResolvedValue({
          pass: false,
          reason: HEURISTIC_REASONS.RECENCY_TOO_OLD,
        }),
      };
      const result = await processEnrichmentJob(
        { candidateId: CANDIDATE_ID },
        { db: mock.db, seams },
      );
      expect(result.terminalStatus).toBe("heuristic_filtered");
      expect(result.failureReason).toBe(HEURISTIC_REASONS.RECENCY_TOO_OLD);
      expect(mock.state.updatedRows.length).toBe(1);
      const update = mock.state.updatedRows[0];
      expect(update.status).toBe("heuristic_filtered");
      expect(update.statusReason).toBe(HEURISTIC_REASONS.RECENCY_TOO_OLD);
      expect(update.processedAt).toBeInstanceOf(Date);
    });

    it("writes statusReason='unknown' when seam omits reason on reject", async () => {
      const seams: EnrichmentSeams = {
        runHeuristic: jest.fn().mockResolvedValue({ pass: false }),
      };
      const result = await processEnrichmentJob(
        { candidateId: CANDIDATE_ID },
        { db: mock.db, seams },
      );
      expect(result.terminalStatus).toBe("heuristic_filtered");
      expect(result.failureReason).toBe("unknown");
      expect(mock.state.updatedRows[0].statusReason).toBe("unknown");
    });

    it.each([
      [HEURISTIC_REASONS.SUMMARY_AND_TITLE_EMPTY],
      [HEURISTIC_REASONS.NOISE_LINKBAIT],
      [HEURISTIC_REASONS.NOISE_LISTICLE],
      [HEURISTIC_REASONS.NOISE_PAID],
      [HEURISTIC_REASONS.BODY_TIMEOUT],
      [HEURISTIC_REASONS.BODY_4XX],
      [HEURISTIC_REASONS.BODY_5XX],
      [HEURISTIC_REASONS.BODY_TOO_SHORT],
    ])("propagates reject reason %s through to status_reason", async (reason) => {
      const seams: EnrichmentSeams = {
        runHeuristic: jest.fn().mockResolvedValue({ pass: false, reason }),
      };
      const result = await processEnrichmentJob(
        { candidateId: CANDIDATE_ID },
        { db: mock.db, seams },
      );
      expect(result.failureReason).toBe(reason);
      expect(mock.state.updatedRows[0].statusReason).toBe(reason);
    });
  });

  describe("heuristic pass path", () => {
    it("writes status=heuristic_passed + body_text on pass", async () => {
      const body = { text: "Article body content for the test", truncated: false };
      const seams: EnrichmentSeams = {
        runHeuristic: jest.fn().mockResolvedValue({ pass: true, body }),
      };
      const result = await processEnrichmentJob(
        { candidateId: CANDIDATE_ID },
        { db: mock.db, seams },
      );
      expect(result.terminalStatus).toBe("heuristic_passed");
      expect(result.failureReason).toBeNull();
      expect(mock.state.updatedRows.length).toBe(1);
      const update = mock.state.updatedRows[0];
      expect(update.status).toBe("heuristic_passed");
      expect(update.bodyText).toBe(body.text);
      expect(update.statusReason).toBeUndefined();
      expect(update.processedAt).toBeInstanceOf(Date);
    });

    it("flags status_reason=body_truncated when truncated=true (still passes)", async () => {
      const body = { text: "x".repeat(500), truncated: true };
      const seams: EnrichmentSeams = {
        runHeuristic: jest.fn().mockResolvedValue({ pass: true, body }),
      };
      const result = await processEnrichmentJob(
        { candidateId: CANDIDATE_ID },
        { db: mock.db, seams },
      );
      expect(result.terminalStatus).toBe("heuristic_passed");
      expect(result.failureReason).toBeNull();
      const update = mock.state.updatedRows[0];
      expect(update.status).toBe("heuristic_passed");
      expect(update.bodyText).toBe(body.text);
      expect(update.statusReason).toBe(HEURISTIC_REASONS.BODY_TRUNCATED);
    });

    it("does not write bodyText when seam omits body (defensive)", async () => {
      const seams: EnrichmentSeams = {
        runHeuristic: jest.fn().mockResolvedValue({ pass: true }),
      };
      const result = await processEnrichmentJob(
        { candidateId: CANDIDATE_ID },
        { db: mock.db, seams },
      );
      expect(result.terminalStatus).toBe("heuristic_passed");
      const update = mock.state.updatedRows[0];
      expect(update.status).toBe("heuristic_passed");
      expect(update.bodyText).toBeUndefined();
    });
  });
});
