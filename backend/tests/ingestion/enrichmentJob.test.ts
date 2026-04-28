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

  describe("relevance gate (12e.4)", () => {
    const passingHeuristic = {
      pass: true,
      body: { text: "article body content for the test", truncated: false },
    };

    function passingHeuristicSeams(
      runRelevanceGate: jest.Mock,
    ): EnrichmentSeams {
      return {
        runHeuristic: jest.fn().mockResolvedValue(passingHeuristic),
        runRelevanceGate,
      };
    }

    it("preserves heuristic_passed terminal when runRelevanceGate is NOT provided", async () => {
      const seams: EnrichmentSeams = {
        runHeuristic: jest.fn().mockResolvedValue(passingHeuristic),
      };
      const result = await processEnrichmentJob(
        { candidateId: CANDIDATE_ID },
        { db: mock.db, seams },
      );
      expect(result.terminalStatus).toBe("heuristic_passed");
      // Only the heuristic-stage update fired (no relevance update).
      expect(mock.state.updatedRows.length).toBe(1);
    });

    it("relevance pass writes status=llm_relevant + sector + llm_judgment_raw", async () => {
      const raw = {
        model: "claude-haiku-4-5-20251001",
        promptText: "prompt",
        responseText: '{"relevant":true,"sector":"semiconductors","reason":"x"}',
        latencyMs: 500,
        attempts: 1,
      };
      const runRelevanceGate = jest.fn().mockResolvedValue({
        relevant: true,
        sector: "semiconductors",
        reason: "TSMC earnings",
        raw,
      });
      const result = await processEnrichmentJob(
        { candidateId: CANDIDATE_ID },
        { db: mock.db, seams: passingHeuristicSeams(runRelevanceGate) },
      );
      expect(result.terminalStatus).toBe("llm_relevant");
      expect(result.failureReason).toBeNull();
      // Two updates: heuristic-stage + relevance-stage.
      expect(mock.state.updatedRows.length).toBe(2);
      const relevanceUpdate = mock.state.updatedRows[1];
      expect(relevanceUpdate.status).toBe("llm_relevant");
      expect(relevanceUpdate.sector).toBe("semiconductors");
      expect(relevanceUpdate.llmJudgmentRaw).toEqual(raw);
      expect(relevanceUpdate.processedAt).toBeInstanceOf(Date);
    });

    it("relevance reject writes status=llm_rejected, sector NULL, status_reason=rejectionReason", async () => {
      const raw = {
        model: "claude-haiku-4-5-20251001",
        promptText: "prompt",
        responseText: '{"relevant":false,"reason":"sports"}',
        latencyMs: 600,
        attempts: 1,
      };
      const runRelevanceGate = jest.fn().mockResolvedValue({
        relevant: false,
        rejectionReason: "llm_rejected",
        reason: "sports content",
        raw,
      });
      const result = await processEnrichmentJob(
        { candidateId: CANDIDATE_ID },
        { db: mock.db, seams: passingHeuristicSeams(runRelevanceGate) },
      );
      expect(result.terminalStatus).toBe("llm_rejected");
      expect(result.failureReason).toBe("llm_rejected");
      const relevanceUpdate = mock.state.updatedRows[1];
      expect(relevanceUpdate.status).toBe("llm_rejected");
      expect(relevanceUpdate.statusReason).toBe("llm_rejected");
      // sector stays unset on rejection.
      expect(relevanceUpdate.sector).toBeUndefined();
      // Raw is persisted even on rejection (audit surface).
      expect(relevanceUpdate.llmJudgmentRaw).toEqual(raw);
    });

    it.each([
      ["llm_parse_error"],
      ["llm_timeout"],
      ["llm_no_api_key"],
      ["llm_api_error"],
      ["llm_rate_limited"],
      ["llm_empty"],
    ])("propagates rejectionReason=%s into status_reason", async (reason) => {
      const runRelevanceGate = jest.fn().mockResolvedValue({
        relevant: false,
        rejectionReason: reason,
      });
      const result = await processEnrichmentJob(
        { candidateId: CANDIDATE_ID },
        { db: mock.db, seams: passingHeuristicSeams(runRelevanceGate) },
      );
      expect(result.terminalStatus).toBe("llm_rejected");
      expect(result.failureReason).toBe(reason);
      const relevanceUpdate = mock.state.updatedRows[1];
      expect(relevanceUpdate.statusReason).toBe(reason);
    });

    it("persists raw even when relevance is rejected (audit surface)", async () => {
      const raw = {
        model: "claude-haiku-4-5-20251001",
        promptText: "p",
        responseText: '{"relevant":false,"reason":"r"}',
        latencyMs: 100,
        attempts: 1,
      };
      const runRelevanceGate = jest.fn().mockResolvedValue({
        relevant: false,
        rejectionReason: "llm_rejected",
        raw,
      });
      await processEnrichmentJob(
        { candidateId: CANDIDATE_ID },
        { db: mock.db, seams: passingHeuristicSeams(runRelevanceGate) },
      );
      expect(mock.state.updatedRows[1].llmJudgmentRaw).toEqual(raw);
    });

    it("does NOT persist raw when seam never got a successful Haiku call", async () => {
      // E.g. timeout / no_api_key — no text returned, raw is undefined.
      const runRelevanceGate = jest.fn().mockResolvedValue({
        relevant: false,
        rejectionReason: "llm_timeout",
      });
      await processEnrichmentJob(
        { candidateId: CANDIDATE_ID },
        { db: mock.db, seams: passingHeuristicSeams(runRelevanceGate) },
      );
      const relevanceUpdate = mock.state.updatedRows[1];
      expect(relevanceUpdate.llmJudgmentRaw).toBeUndefined();
    });

    it("does NOT call runRelevanceGate when heuristic rejects", async () => {
      const runRelevanceGate = jest.fn();
      const seams: EnrichmentSeams = {
        runHeuristic: jest.fn().mockResolvedValue({
          pass: false,
          reason: HEURISTIC_REASONS.RECENCY_TOO_OLD,
        }),
        runRelevanceGate,
      };
      const result = await processEnrichmentJob(
        { candidateId: CANDIDATE_ID },
        { db: mock.db, seams },
      );
      expect(result.terminalStatus).toBe("heuristic_filtered");
      expect(runRelevanceGate).not.toHaveBeenCalled();
      // Only one update — the heuristic-rejection write.
      expect(mock.state.updatedRows.length).toBe(1);
    });

    it("falls back to 'llm_rejected' status_reason when rejectionReason omitted", async () => {
      const runRelevanceGate = jest.fn().mockResolvedValue({
        relevant: false,
        // rejectionReason intentionally omitted
      });
      const result = await processEnrichmentJob(
        { candidateId: CANDIDATE_ID },
        { db: mock.db, seams: passingHeuristicSeams(runRelevanceGate) },
      );
      expect(result.failureReason).toBe("llm_rejected");
      expect(mock.state.updatedRows[1].statusReason).toBe("llm_rejected");
    });

    it("relevance pass with sector undefined → writes sector=null", async () => {
      // Defensive — shouldn't happen given seam contract, but the
      // orchestration body should not crash on missing sector.
      const runRelevanceGate = jest.fn().mockResolvedValue({
        relevant: true,
        // sector intentionally omitted
        raw: { model: "x", promptText: "p", responseText: "r", latencyMs: 1, attempts: 1 },
      });
      await processEnrichmentJob(
        { candidateId: CANDIDATE_ID },
        { db: mock.db, seams: passingHeuristicSeams(runRelevanceGate) },
      );
      const relevanceUpdate = mock.state.updatedRows[1];
      expect(relevanceUpdate.status).toBe("llm_relevant");
      expect(relevanceUpdate.sector).toBeNull();
    });
  });

  describe("fact extraction (12e.5a)", () => {
    const passingHeuristic = {
      pass: true,
      body: { text: "article body content for the test", truncated: false },
    };
    const passingRelevance = {
      relevant: true,
      sector: "semiconductors" as const,
      reason: "TSMC earnings",
      raw: {
        model: "claude-haiku-4-5-20251001",
        promptText: "p",
        responseText: '{"relevant":true,"sector":"semiconductors","reason":"x"}',
        latencyMs: 500,
        attempts: 1,
      },
    };

    function chainSeams(extractFacts: jest.Mock | undefined): EnrichmentSeams {
      return {
        runHeuristic: jest.fn().mockResolvedValue(passingHeuristic),
        runRelevanceGate: jest.fn().mockResolvedValue(passingRelevance),
        ...(extractFacts ? { extractFacts } : {}),
      };
    }

    it("preserves llm_relevant terminal when extractFacts is NOT provided", async () => {
      const result = await processEnrichmentJob(
        { candidateId: CANDIDATE_ID },
        { db: mock.db, seams: chainSeams(undefined) },
      );
      expect(result.terminalStatus).toBe("llm_relevant");
      // Two updates: heuristic + relevance. No facts update.
      expect(mock.state.updatedRows.length).toBe(2);
    });

    it("facts pass writes status=facts_extracted + facts + facts_extracted_at + raw", async () => {
      const factsBlob = {
        facts: [
          { text: "TSMC reported $24.6B Q1 revenue.", category: "metric" },
          { text: "Revenue grew 58% year-over-year.", category: "metric" },
          { text: "CEO C.C. Wei attributed the beat to HPC demand.", category: "actor" },
          { text: "Gross margin expanded to 53.1%.", category: "metric" },
          { text: "Q2 guidance was $26.5B.", category: "timeframe" },
        ],
      };
      const raw = {
        model: "claude-haiku-4-5-20251001",
        promptText: "facts prompt",
        responseText: JSON.stringify(factsBlob),
        latencyMs: 800,
        attempts: 1,
      };
      const extractFacts = jest.fn().mockResolvedValue({
        ok: true,
        facts: factsBlob,
        raw,
      });
      const result = await processEnrichmentJob(
        { candidateId: CANDIDATE_ID },
        { db: mock.db, seams: chainSeams(extractFacts) },
      );
      expect(result.terminalStatus).toBe("facts_extracted");
      expect(result.failureReason).toBeNull();
      // Three updates: heuristic + relevance + facts.
      expect(mock.state.updatedRows.length).toBe(3);
      const factsUpdate = mock.state.updatedRows[2];
      expect(factsUpdate.status).toBe("facts_extracted");
      expect(factsUpdate.facts).toEqual(factsBlob);
      expect(factsUpdate.factsExtractedAt).toBeInstanceOf(Date);
      expect(factsUpdate.factsExtractionRaw).toEqual(raw);
      expect(factsUpdate.processedAt).toBeInstanceOf(Date);
    });

    it("facts reject writes status=failed, status_reason=rejectionReason, facts unset", async () => {
      const raw = {
        model: "claude-haiku-4-5-20251001",
        promptText: "p",
        responseText: 'not json',
        latencyMs: 1200,
        attempts: 2,
      };
      const extractFacts = jest.fn().mockResolvedValue({
        ok: false,
        rejectionReason: "facts_parse_error",
        raw,
      });
      const result = await processEnrichmentJob(
        { candidateId: CANDIDATE_ID },
        { db: mock.db, seams: chainSeams(extractFacts) },
      );
      expect(result.terminalStatus).toBe("failed");
      expect(result.failureReason).toBe("facts_parse_error");
      const factsUpdate = mock.state.updatedRows[2];
      expect(factsUpdate.status).toBe("failed");
      expect(factsUpdate.statusReason).toBe("facts_parse_error");
      expect(factsUpdate.facts).toBeUndefined();
      expect(factsUpdate.factsExtractedAt).toBeUndefined();
      // Raw is persisted even on rejection (audit surface).
      expect(factsUpdate.factsExtractionRaw).toEqual(raw);
    });

    it.each([
      ["facts_parse_error"],
      ["facts_timeout"],
      ["facts_no_api_key"],
      ["facts_api_error"],
      ["facts_rate_limited"],
      ["facts_empty"],
    ])("propagates rejectionReason=%s into status_reason", async (reason) => {
      const extractFacts = jest.fn().mockResolvedValue({
        ok: false,
        rejectionReason: reason,
      });
      const result = await processEnrichmentJob(
        { candidateId: CANDIDATE_ID },
        { db: mock.db, seams: chainSeams(extractFacts) },
      );
      expect(result.terminalStatus).toBe("failed");
      expect(result.failureReason).toBe(reason);
      const factsUpdate = mock.state.updatedRows[2];
      expect(factsUpdate.statusReason).toBe(reason);
    });

    it("does NOT persist raw when seam never got a successful Haiku call", async () => {
      const extractFacts = jest.fn().mockResolvedValue({
        ok: false,
        rejectionReason: "facts_timeout",
      });
      await processEnrichmentJob(
        { candidateId: CANDIDATE_ID },
        { db: mock.db, seams: chainSeams(extractFacts) },
      );
      const factsUpdate = mock.state.updatedRows[2];
      expect(factsUpdate.factsExtractionRaw).toBeUndefined();
    });

    it("falls back to 'facts_parse_error' status_reason when rejectionReason omitted", async () => {
      const extractFacts = jest.fn().mockResolvedValue({
        ok: false,
        // rejectionReason intentionally omitted
      });
      const result = await processEnrichmentJob(
        { candidateId: CANDIDATE_ID },
        { db: mock.db, seams: chainSeams(extractFacts) },
      );
      expect(result.failureReason).toBe("facts_parse_error");
      expect(mock.state.updatedRows[2].statusReason).toBe("facts_parse_error");
    });

    it("does NOT call extractFacts when relevance rejects", async () => {
      const extractFacts = jest.fn();
      const seams: EnrichmentSeams = {
        runHeuristic: jest.fn().mockResolvedValue(passingHeuristic),
        runRelevanceGate: jest.fn().mockResolvedValue({
          relevant: false,
          rejectionReason: "llm_rejected",
        }),
        extractFacts,
      };
      const result = await processEnrichmentJob(
        { candidateId: CANDIDATE_ID },
        { db: mock.db, seams },
      );
      expect(result.terminalStatus).toBe("llm_rejected");
      expect(extractFacts).not.toHaveBeenCalled();
      // Two updates: heuristic + relevance-rejection.
      expect(mock.state.updatedRows.length).toBe(2);
    });

    it("does NOT call extractFacts when heuristic rejects", async () => {
      const extractFacts = jest.fn();
      const seams: EnrichmentSeams = {
        runHeuristic: jest.fn().mockResolvedValue({
          pass: false,
          reason: HEURISTIC_REASONS.RECENCY_TOO_OLD,
        }),
        runRelevanceGate: jest.fn(),
        extractFacts,
      };
      const result = await processEnrichmentJob(
        { candidateId: CANDIDATE_ID },
        { db: mock.db, seams },
      );
      expect(result.terminalStatus).toBe("heuristic_filtered");
      expect(extractFacts).not.toHaveBeenCalled();
    });
  });
});
