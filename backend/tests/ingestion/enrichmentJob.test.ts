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

  describe("12e.5c short-circuits (whole-job + per-stage)", () => {
    // Helper: queue the snapshot-row select with the given persisted state.
    // The snapshot read is the FIRST select in `processEnrichmentJob`; later
    // selects (if any) are not used by the orchestration body itself.
    function queueSnapshot(rows: Record<string, unknown>[]): void {
      mock.queueSelect(rows);
    }

    function fullSeams(): {
      seams: EnrichmentSeams;
      runHeuristic: jest.Mock;
      runRelevanceGate: jest.Mock;
      extractFacts: jest.Mock;
    } {
      const runHeuristic = jest.fn();
      const runRelevanceGate = jest.fn();
      const extractFacts = jest.fn();
      return {
        seams: { runHeuristic, runRelevanceGate, extractFacts },
        runHeuristic,
        runRelevanceGate,
        extractFacts,
      };
    }

    describe("whole-job short-circuit on terminal-state snapshot", () => {
      it.each([
        ["heuristic_filtered", "recency_too_old"],
        ["llm_rejected", "llm_rejected"],
        ["failed", "facts_parse_error"],
      ])(
        "terminal-rejection %s — zero seam invocations, envelope echoes status_reason",
        async (status, statusReason) => {
          queueSnapshot([
            {
              status,
              statusReason,
              llmJudgmentRaw: null,
              factsExtractedAt: null,
              tierOutputs: null,
              resolvedEventId: null,
            },
          ]);
          const { seams, runHeuristic, runRelevanceGate, extractFacts } =
            fullSeams();
          const result = await processEnrichmentJob(
            { candidateId: CANDIDATE_ID },
            { db: mock.db, seams },
          );
          expect(result.terminalStatus).toBe(status);
          expect(result.failureReason).toBe(statusReason);
          expect(result.resolvedEventId).toBeNull();
          // No seam ran.
          expect(runHeuristic).not.toHaveBeenCalled();
          expect(runRelevanceGate).not.toHaveBeenCalled();
          expect(extractFacts).not.toHaveBeenCalled();
          // No DB writes.
          expect(mock.state.updatedRows.length).toBe(0);
        },
      );

      it("terminal-success tier_generated — zero seam invocations, failureReason null", async () => {
        queueSnapshot([
          {
            status: "tier_generated",
            statusReason: null,
            llmJudgmentRaw: { fake: true },
            factsExtractedAt: new Date("2026-04-28T00:00:00Z"),
            tierOutputs: { accessible: {}, briefed: {}, technical: {} },
            resolvedEventId: null,
          },
        ]);
        const { seams, runHeuristic, runRelevanceGate, extractFacts } =
          fullSeams();
        const result = await processEnrichmentJob(
          { candidateId: CANDIDATE_ID },
          { db: mock.db, seams },
        );
        expect(result.terminalStatus).toBe("tier_generated");
        expect(result.failureReason).toBeNull();
        expect(runHeuristic).not.toHaveBeenCalled();
        expect(runRelevanceGate).not.toHaveBeenCalled();
        expect(extractFacts).not.toHaveBeenCalled();
        expect(mock.state.updatedRows.length).toBe(0);
      });

      it("terminal-success published — envelope carries resolvedEventId from snapshot", async () => {
        const eventId = "11111111-1111-1111-1111-111111111111";
        queueSnapshot([
          {
            status: "published",
            statusReason: null,
            llmJudgmentRaw: { fake: true },
            factsExtractedAt: new Date(),
            tierOutputs: { accessible: {}, briefed: {}, technical: {} },
            resolvedEventId: eventId,
          },
        ]);
        const { seams, runHeuristic, runRelevanceGate, extractFacts } =
          fullSeams();
        const result = await processEnrichmentJob(
          { candidateId: CANDIDATE_ID },
          { db: mock.db, seams },
        );
        expect(result.terminalStatus).toBe("published");
        expect(result.failureReason).toBeNull();
        expect(result.resolvedEventId).toBe(eventId);
        expect(runHeuristic).not.toHaveBeenCalled();
        expect(runRelevanceGate).not.toHaveBeenCalled();
        expect(extractFacts).not.toHaveBeenCalled();
      });

      it("terminal-rejection with NULL status_reason falls back to 'unknown'", async () => {
        queueSnapshot([
          {
            status: "failed",
            statusReason: null,
            llmJudgmentRaw: null,
            factsExtractedAt: null,
            tierOutputs: null,
            resolvedEventId: null,
          },
        ]);
        const { seams } = fullSeams();
        const result = await processEnrichmentJob(
          { candidateId: CANDIDATE_ID },
          { db: mock.db, seams },
        );
        expect(result.terminalStatus).toBe("failed");
        expect(result.failureReason).toBe("unknown");
      });
    });

    describe("per-stage short-circuit (relevance / facts already ran)", () => {
      const passingHeuristic = {
        pass: true,
        body: { text: "article body for the test", truncated: false },
      };

      it("skips runRelevanceGate when llm_judgment_raw set + status past heuristic_passed", async () => {
        queueSnapshot([
          {
            status: "llm_relevant",
            statusReason: null,
            llmJudgmentRaw: { fake: true },
            factsExtractedAt: null,
            tierOutputs: null,
            resolvedEventId: null,
          },
        ]);
        const runHeuristic = jest.fn().mockResolvedValue(passingHeuristic);
        const runRelevanceGate = jest.fn();
        const extractFacts = jest.fn().mockResolvedValue({
          ok: true,
          facts: { facts: [] },
        });
        const result = await processEnrichmentJob(
          { candidateId: CANDIDATE_ID },
          {
            db: mock.db,
            seams: { runHeuristic, runRelevanceGate, extractFacts },
          },
        );
        // Heuristic skipped (snapshot status='llm_relevant' is in
        // HEURISTIC_ALREADY_RAN — fix #65), relevance skipped (verdict
        // already persisted), facts ran.
        expect(runHeuristic).not.toHaveBeenCalled();
        expect(runRelevanceGate).not.toHaveBeenCalled();
        expect(extractFacts).toHaveBeenCalledTimes(1);
        expect(result.terminalStatus).toBe("facts_extracted");
      });

      it("skips extractFacts when facts_extracted_at set", async () => {
        queueSnapshot([
          {
            status: "facts_extracted",
            statusReason: null,
            llmJudgmentRaw: { fake: true },
            factsExtractedAt: new Date("2026-04-28T00:00:00Z"),
            tierOutputs: null,
            resolvedEventId: null,
          },
        ]);
        const runHeuristic = jest.fn().mockResolvedValue(passingHeuristic);
        const runRelevanceGate = jest.fn();
        const extractFacts = jest.fn();
        const result = await processEnrichmentJob(
          { candidateId: CANDIDATE_ID },
          {
            db: mock.db,
            seams: { runHeuristic, runRelevanceGate, extractFacts },
          },
        );
        // All three stages skipped (snapshot status='facts_extracted' is in
        // HEURISTIC_ALREADY_RAN — fix #65; relevance + facts already done).
        // Result envelope echoes the fall-through facts_extracted.
        expect(runHeuristic).not.toHaveBeenCalled();
        expect(runRelevanceGate).not.toHaveBeenCalled();
        expect(extractFacts).not.toHaveBeenCalled();
        expect(result.terminalStatus).toBe("facts_extracted");
        expect(result.failureReason).toBeNull();
      });

      it("does NOT short-circuit relevance on heuristic_passed snapshot (no llm_judgment_raw yet)", async () => {
        queueSnapshot([
          {
            status: "heuristic_passed",
            statusReason: null,
            llmJudgmentRaw: null,
            factsExtractedAt: null,
            tierOutputs: null,
            resolvedEventId: null,
          },
        ]);
        const runHeuristic = jest.fn().mockResolvedValue(passingHeuristic);
        const runRelevanceGate = jest.fn().mockResolvedValue({
          relevant: true,
          sector: "ai",
          reason: "x",
        });
        const extractFacts = jest.fn().mockResolvedValue({
          ok: true,
          facts: { facts: [] },
        });
        await processEnrichmentJob(
          { candidateId: CANDIDATE_ID },
          {
            db: mock.db,
            seams: { runHeuristic, runRelevanceGate, extractFacts },
          },
        );
        // Heuristic skipped (snapshot status='heuristic_passed' is in
        // HEURISTIC_ALREADY_RAN — fix #65). Relevance + facts still run
        // because their per-stage short-circuit predicates require
        // llmJudgmentRaw / factsExtractedAt to be persisted.
        expect(runHeuristic).not.toHaveBeenCalled();
        expect(runRelevanceGate).toHaveBeenCalledTimes(1);
        expect(extractFacts).toHaveBeenCalledTimes(1);
      });

      it("does NOT short-circuit when snapshot is null (e.g., row not found)", async () => {
        // Empty select result → snapshot is null → all stages run as
        // before (preserves backward compatibility with existing tests
        // that never queued a snapshot).
        queueSnapshot([]);
        const runHeuristic = jest.fn().mockResolvedValue(passingHeuristic);
        const runRelevanceGate = jest.fn().mockResolvedValue({
          relevant: true,
          sector: "ai",
          reason: "x",
        });
        const extractFacts = jest.fn().mockResolvedValue({
          ok: true,
          facts: { facts: [] },
        });
        await processEnrichmentJob(
          { candidateId: CANDIDATE_ID },
          {
            db: mock.db,
            seams: { runHeuristic, runRelevanceGate, extractFacts },
          },
        );
        expect(runHeuristic).toHaveBeenCalledTimes(1);
        expect(runRelevanceGate).toHaveBeenCalledTimes(1);
        expect(extractFacts).toHaveBeenCalledTimes(1);
      });
    });

    describe("heuristic short-circuit (fix #65)", () => {
      const passingHeuristic = {
        pass: true,
        body: { text: "article body for the test", truncated: false },
      };

      it("re-enqueue of facts_extracted candidate: heuristic skips, tier orchestration runs, reaches published", async () => {
        // Reproducer for #65 — sub-step 8 smoke caught a re-enqueued
        // facts_extracted candidate stuck at tier_parse_error because the
        // unconditional heuristic re-run transiently overwrote status to
        // 'heuristic_passed', which the tier seam's precondition rejected
        // as a stage mismatch. Post-fix, heuristic skips on this snapshot
        // and the chain proceeds straight to tier orchestration.
        queueSnapshot([
          {
            status: "facts_extracted",
            statusReason: null,
            llmJudgmentRaw: { fake: true },
            factsExtractedAt: new Date("2026-04-28T00:00:00Z"),
            tierOutputs: null,
            resolvedEventId: null,
          },
        ]);
        const runHeuristic = jest.fn();
        const runRelevanceGate = jest.fn();
        const extractFacts = jest.fn();
        const processTier = jest.fn().mockResolvedValue({
          candidateId: CANDIDATE_ID,
          ranTiers: ["accessible", "briefed", "technical"],
          skippedTiers: [],
          failedTier: null,
          completed: true,
        });
        const writeEventMock = jest
          .fn()
          .mockResolvedValue({ eventId: "EVENT_ID" });
        const result = await processEnrichmentJob(
          { candidateId: CANDIDATE_ID },
          {
            db: mock.db,
            seams: { runHeuristic, runRelevanceGate, extractFacts },
            processTier,
            writeEvent: writeEventMock,
          },
        );
        expect(runHeuristic).not.toHaveBeenCalled();
        expect(runRelevanceGate).not.toHaveBeenCalled();
        expect(extractFacts).not.toHaveBeenCalled();
        expect(processTier).toHaveBeenCalledTimes(1);
        expect(result.terminalStatus).toBe("published");
      });

      it("first-run candidate at discovered: heuristic runs normally", async () => {
        // Regression guard — the short-circuit must NOT fire for a fresh
        // candidate at status='discovered'. Anchors the negative side of
        // HEURISTIC_ALREADY_RAN's membership.
        queueSnapshot([
          {
            status: "discovered",
            statusReason: null,
            llmJudgmentRaw: null,
            factsExtractedAt: null,
            tierOutputs: null,
            resolvedEventId: null,
          },
        ]);
        const runHeuristic = jest.fn().mockResolvedValue(passingHeuristic);
        const runRelevanceGate = jest.fn().mockResolvedValue({
          relevant: true,
          sector: "ai",
          reason: "x",
        });
        const extractFacts = jest.fn().mockResolvedValue({
          ok: true,
          facts: { facts: [] },
        });
        await processEnrichmentJob(
          { candidateId: CANDIDATE_ID },
          {
            db: mock.db,
            seams: { runHeuristic, runRelevanceGate, extractFacts },
          },
        );
        expect(runHeuristic).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("12e.5c sub-step 2: tier-orchestration wiring", () => {
    const passingHeuristic = {
      pass: true,
      body: { text: "article body for the test", truncated: false },
    };

    function fullSeamSet() {
      const runHeuristic = jest.fn().mockResolvedValue(passingHeuristic);
      const runRelevanceGate = jest.fn().mockResolvedValue({
        relevant: true,
        sector: "ai",
        reason: "x",
      });
      const extractFacts = jest.fn().mockResolvedValue({
        ok: true,
        facts: { facts: [{ text: "fact text >=10 chars", category: "actor" }] },
      });
      return { runHeuristic, runRelevanceGate, extractFacts };
    }

    it("full chain on a fresh candidate produces terminalStatus=published (post-sub-step-3 wiring)", async () => {
      // Sub-step 2 originally asserted terminalStatus=tier_generated as
      // the chain's terminal, but sub-step 3 extends the chain through
      // writeEvent. With both wired, full happy-path lands at
      // 'published'. We still verify the upstream seams + tier
      // orchestration ran exactly once (sub-step 2's intent), and
      // additionally that writeEvent is invoked on tier completion
      // (sub-step 3's intent).
      const { runHeuristic, runRelevanceGate, extractFacts } = fullSeamSet();
      const processTier = jest.fn().mockResolvedValue({
        candidateId: CANDIDATE_ID,
        ranTiers: ["accessible", "briefed", "technical"],
        skippedTiers: [],
        failedTier: null,
        completed: true,
      });
      const writeEventMock = jest
        .fn()
        .mockResolvedValue({ eventId: "55555555-5555-5555-5555-555555555555" });
      const result = await processEnrichmentJob(
        { candidateId: CANDIDATE_ID },
        {
          db: mock.db,
          seams: { runHeuristic, runRelevanceGate, extractFacts },
          processTier,
          writeEvent: writeEventMock,
        },
      );
      expect(result.terminalStatus).toBe("published");
      expect(result.failureReason).toBeNull();
      expect(result.resolvedEventId).toBe(
        "55555555-5555-5555-5555-555555555555",
      );
      // All upstream seams ran exactly once.
      expect(runHeuristic).toHaveBeenCalledTimes(1);
      expect(runRelevanceGate).toHaveBeenCalledTimes(1);
      expect(extractFacts).toHaveBeenCalledTimes(1);
      // Tier orchestrator invoked with the candidate id + db dep.
      expect(processTier).toHaveBeenCalledTimes(1);
      expect(processTier).toHaveBeenCalledWith(CANDIDATE_ID, { db: mock.db });
      // writeEvent invoked after tier completion.
      expect(writeEventMock).toHaveBeenCalledTimes(1);
    });

    it("tier-stage failure propagates as terminalStatus=failed with failed-tier reason", async () => {
      const { runHeuristic, runRelevanceGate, extractFacts } = fullSeamSet();
      const processTier = jest.fn().mockResolvedValue({
        candidateId: CANDIDATE_ID,
        ranTiers: ["accessible", "briefed"],
        skippedTiers: [],
        failedTier: { tier: "technical", reason: "TIER_PARSE_ERROR" },
        completed: false,
      });
      const result = await processEnrichmentJob(
        { candidateId: CANDIDATE_ID },
        {
          db: mock.db,
          seams: { runHeuristic, runRelevanceGate, extractFacts },
          processTier,
        },
      );
      expect(result.terminalStatus).toBe("failed");
      expect(result.failureReason).toBe("TIER_PARSE_ERROR");
      // The orchestrator owns the DB write that sets status_reason; this
      // mock-injected version doesn't write, so we only assert the
      // envelope here.
    });

    it("tier orchestration neither completed nor failed → fall-through terminal facts_extracted", async () => {
      const { runHeuristic, runRelevanceGate, extractFacts } = fullSeamSet();
      const processTier = jest.fn().mockResolvedValue({
        candidateId: CANDIDATE_ID,
        ranTiers: [],
        skippedTiers: [],
        failedTier: null,
        completed: false,
      });
      const result = await processEnrichmentJob(
        { candidateId: CANDIDATE_ID },
        {
          db: mock.db,
          seams: { runHeuristic, runRelevanceGate, extractFacts },
          processTier,
        },
      );
      expect(result.terminalStatus).toBe("facts_extracted");
      expect(result.failureReason).toBeNull();
    });

    it("tier-stage runs even when relevance + facts short-circuit from snapshot", async () => {
      // Snapshot at facts_extracted: relevance + facts skip; tier
      // orchestration is the only LLM-bearing stage that runs.
      mock.queueSelect([
        {
          status: "facts_extracted",
          statusReason: null,
          llmJudgmentRaw: { fake: true },
          factsExtractedAt: new Date("2026-04-28T00:00:00Z"),
          tierOutputs: null,
          resolvedEventId: null,
        },
      ]);
      const runHeuristic = jest.fn().mockResolvedValue(passingHeuristic);
      const runRelevanceGate = jest.fn();
      const extractFacts = jest.fn();
      const processTier = jest.fn().mockResolvedValue({
        candidateId: CANDIDATE_ID,
        ranTiers: ["accessible", "briefed", "technical"],
        skippedTiers: [],
        failedTier: null,
        completed: true,
      });
      // Without writeEvent injection, sub-step 3's wiring would call
      // the real writeEvent which fails on the empty mock. Inject a
      // succeeding mock so we can isolate the tier-orchestration cross-
      // cut from the writeEvent path.
      const writeEventMock = jest
        .fn()
        .mockResolvedValue({ eventId: "EVENT_ID" });
      const result = await processEnrichmentJob(
        { candidateId: CANDIDATE_ID },
        {
          db: mock.db,
          seams: { runHeuristic, runRelevanceGate, extractFacts },
          processTier,
          writeEvent: writeEventMock,
        },
      );
      // Heuristic also skipped (fix #65 — snapshot status='facts_extracted'
      // is in HEURISTIC_ALREADY_RAN). Tier orchestration is the only
      // LLM-bearing stage that runs.
      expect(runHeuristic).not.toHaveBeenCalled();
      expect(runRelevanceGate).not.toHaveBeenCalled();
      expect(extractFacts).not.toHaveBeenCalled();
      expect(processTier).toHaveBeenCalledTimes(1);
      expect(writeEventMock).toHaveBeenCalledTimes(1);
      // Now with sub-step 3 wired, the chain continues past tier_generated
      // through writeEvent and lands at terminalStatus='published'.
      expect(result.terminalStatus).toBe("published");
    });
  });

  describe("12e.5c sub-step 3: writeEvent wiring", () => {
    const passingHeuristic = {
      pass: true,
      body: { text: "article body for the test", truncated: false },
    };

    function fullSeams() {
      return {
        runHeuristic: jest.fn().mockResolvedValue(passingHeuristic),
        runRelevanceGate: jest.fn().mockResolvedValue({
          relevant: true,
          sector: "ai",
          reason: "x",
        }),
        extractFacts: jest.fn().mockResolvedValue({
          ok: true,
          facts: { facts: [{ text: "fact text >=10 chars", category: "actor" }] },
        }),
      };
    }

    it("tier success → writeEvent called → terminalStatus=published with eventId", async () => {
      const seams = fullSeams();
      const processTier = jest.fn().mockResolvedValue({
        candidateId: CANDIDATE_ID,
        ranTiers: ["accessible", "briefed", "technical"],
        skippedTiers: [],
        failedTier: null,
        completed: true,
      });
      const writeEventMock = jest
        .fn()
        .mockResolvedValue({ eventId: "44444444-4444-4444-4444-444444444444" });
      const result = await processEnrichmentJob(
        { candidateId: CANDIDATE_ID },
        {
          db: mock.db,
          seams,
          processTier,
          writeEvent: writeEventMock,
        },
      );
      expect(writeEventMock).toHaveBeenCalledTimes(1);
      expect(writeEventMock).toHaveBeenCalledWith(CANDIDATE_ID, { db: mock.db });
      expect(result.terminalStatus).toBe("published");
      expect(result.failureReason).toBeNull();
      expect(result.resolvedEventId).toBe(
        "44444444-4444-4444-4444-444444444444",
      );
    });

    it("writeEvent throw → caught and surfaced as terminalStatus=failed with write_event_error prefix", async () => {
      const seams = fullSeams();
      const processTier = jest.fn().mockResolvedValue({
        candidateId: CANDIDATE_ID,
        ranTiers: ["accessible", "briefed", "technical"],
        skippedTiers: [],
        failedTier: null,
        completed: true,
      });
      const writeEventMock = jest
        .fn()
        .mockRejectedValue(new Error("simulated DB error"));
      const result = await processEnrichmentJob(
        { candidateId: CANDIDATE_ID },
        {
          db: mock.db,
          seams,
          processTier,
          writeEvent: writeEventMock,
        },
      );
      expect(writeEventMock).toHaveBeenCalledTimes(1);
      expect(result.terminalStatus).toBe("failed");
      expect(result.failureReason).toMatch(/^write_event_error: /);
      expect(result.failureReason).toContain("simulated DB error");
      expect(result.resolvedEventId).toBeNull();
    });

    it("writeEvent NOT called when tier orchestration fails", async () => {
      const seams = fullSeams();
      const processTier = jest.fn().mockResolvedValue({
        candidateId: CANDIDATE_ID,
        ranTiers: ["accessible"],
        skippedTiers: [],
        failedTier: { tier: "briefed", reason: "TIER_TIMEOUT" },
        completed: false,
      });
      const writeEventMock = jest.fn();
      const result = await processEnrichmentJob(
        { candidateId: CANDIDATE_ID },
        {
          db: mock.db,
          seams,
          processTier,
          writeEvent: writeEventMock,
        },
      );
      expect(writeEventMock).not.toHaveBeenCalled();
      expect(result.terminalStatus).toBe("failed");
      expect(result.failureReason).toBe("TIER_TIMEOUT");
    });

    it("writeEvent NOT called when tier orchestration neither completed nor failed", async () => {
      const seams = fullSeams();
      const processTier = jest.fn().mockResolvedValue({
        candidateId: CANDIDATE_ID,
        ranTiers: [],
        skippedTiers: [],
        failedTier: null,
        completed: false,
      });
      const writeEventMock = jest.fn();
      const result = await processEnrichmentJob(
        { candidateId: CANDIDATE_ID },
        {
          db: mock.db,
          seams,
          processTier,
          writeEvent: writeEventMock,
        },
      );
      expect(writeEventMock).not.toHaveBeenCalled();
      expect(result.terminalStatus).toBe("facts_extracted");
    });
  });

  describe("12e.5c sub-step 6: per-stage Sentry capture", () => {
    const passingHeuristic = {
      pass: true,
      body: { text: "article body for the test", truncated: false },
    };

    function snapshotWithSlug(slug: string | null): Record<string, unknown> {
      return {
        status: "discovered",
        statusReason: null,
        llmJudgmentRaw: null,
        factsExtractedAt: null,
        tierOutputs: null,
        resolvedEventId: null,
        sourceSlug: slug,
      };
    }

    it("relevance rejection → captureFailure called with stage='relevance' + sourceSlug", async () => {
      mock.queueSelect([snapshotWithSlug("cnbc-markets")]);
      const captureFailure = jest.fn();
      const result = await processEnrichmentJob(
        { candidateId: CANDIDATE_ID },
        {
          db: mock.db,
          seams: {
            runHeuristic: jest.fn().mockResolvedValue(passingHeuristic),
            runRelevanceGate: jest.fn().mockResolvedValue({
              relevant: false,
              rejectionReason: "llm_rejected",
              reason: "sports content",
            }),
          },
          captureFailure,
        },
      );
      expect(result.terminalStatus).toBe("llm_rejected");
      expect(captureFailure).toHaveBeenCalledTimes(1);
      expect(captureFailure).toHaveBeenCalledWith({
        stage: "relevance",
        candidateId: CANDIDATE_ID,
        sourceSlug: "cnbc-markets",
        rejectionReason: "llm_rejected",
      });
    });

    it("facts rejection → captureFailure called with stage='facts'", async () => {
      mock.queueSelect([snapshotWithSlug("import-ai")]);
      const captureFailure = jest.fn();
      await processEnrichmentJob(
        { candidateId: CANDIDATE_ID },
        {
          db: mock.db,
          seams: {
            runHeuristic: jest.fn().mockResolvedValue(passingHeuristic),
            runRelevanceGate: jest.fn().mockResolvedValue({
              relevant: true,
              sector: "ai",
              reason: "x",
            }),
            extractFacts: jest.fn().mockResolvedValue({
              ok: false,
              rejectionReason: "facts_timeout",
            }),
          },
          captureFailure,
        },
      );
      expect(captureFailure).toHaveBeenCalledTimes(1);
      expect(captureFailure).toHaveBeenCalledWith({
        stage: "facts",
        candidateId: CANDIDATE_ID,
        sourceSlug: "import-ai",
        rejectionReason: "facts_timeout",
      });
    });

    it("tier rejection → captureFailure called with stage='tiers' + tier:reason composite", async () => {
      mock.queueSelect([snapshotWithSlug("bloomberg-markets")]);
      const captureFailure = jest.fn();
      await processEnrichmentJob(
        { candidateId: CANDIDATE_ID },
        {
          db: mock.db,
          seams: {
            runHeuristic: jest.fn().mockResolvedValue(passingHeuristic),
            runRelevanceGate: jest.fn().mockResolvedValue({
              relevant: true,
              sector: "finance",
              reason: "x",
            }),
            extractFacts: jest.fn().mockResolvedValue({
              ok: true,
              facts: { facts: [] },
            }),
          },
          processTier: jest.fn().mockResolvedValue({
            candidateId: CANDIDATE_ID,
            ranTiers: ["accessible"],
            skippedTiers: [],
            failedTier: { tier: "briefed", reason: "TIER_RATE_LIMITED" },
            completed: false,
          }),
          captureFailure,
        },
      );
      expect(captureFailure).toHaveBeenCalledTimes(1);
      expect(captureFailure).toHaveBeenCalledWith({
        stage: "tiers",
        candidateId: CANDIDATE_ID,
        sourceSlug: "bloomberg-markets",
        rejectionReason: "briefed:TIER_RATE_LIMITED",
      });
    });

    it("writeEvent throw → captureFailure called with stage='write_event' and original Error", async () => {
      mock.queueSelect([snapshotWithSlug("arstechnica-ai")]);
      const captureFailure = jest.fn();
      const originalError = new Error("PG constraint violation");
      await processEnrichmentJob(
        { candidateId: CANDIDATE_ID },
        {
          db: mock.db,
          seams: {
            runHeuristic: jest.fn().mockResolvedValue(passingHeuristic),
            runRelevanceGate: jest.fn().mockResolvedValue({
              relevant: true,
              sector: "ai",
              reason: "x",
            }),
            extractFacts: jest.fn().mockResolvedValue({
              ok: true,
              facts: { facts: [] },
            }),
          },
          processTier: jest.fn().mockResolvedValue({
            candidateId: CANDIDATE_ID,
            ranTiers: ["accessible", "briefed", "technical"],
            skippedTiers: [],
            failedTier: null,
            completed: true,
          }),
          writeEvent: jest.fn().mockRejectedValue(originalError),
          captureFailure,
        },
      );
      expect(captureFailure).toHaveBeenCalledTimes(1);
      const call = captureFailure.mock.calls[0][0];
      expect(call.stage).toBe("write_event");
      expect(call.candidateId).toBe(CANDIDATE_ID);
      expect(call.sourceSlug).toBe("arstechnica-ai");
      expect(call.rejectionReason).toMatch(/^write_event_error: PG constraint/);
      expect(call.err).toBe(originalError);
    });

    it("tier indeterminate (defensive) → captureFailure called with tier_orchestration_indeterminate", async () => {
      mock.queueSelect([snapshotWithSlug("semianalysis")]);
      const captureFailure = jest.fn();
      await processEnrichmentJob(
        { candidateId: CANDIDATE_ID },
        {
          db: mock.db,
          seams: {
            runHeuristic: jest.fn().mockResolvedValue(passingHeuristic),
            runRelevanceGate: jest.fn().mockResolvedValue({
              relevant: true,
              sector: "semiconductors",
              reason: "x",
            }),
            extractFacts: jest.fn().mockResolvedValue({
              ok: true,
              facts: { facts: [] },
            }),
          },
          processTier: jest.fn().mockResolvedValue({
            candidateId: CANDIDATE_ID,
            ranTiers: [],
            skippedTiers: [],
            failedTier: null,
            completed: false,
          }),
          captureFailure,
        },
      );
      expect(captureFailure).toHaveBeenCalledTimes(1);
      expect(captureFailure).toHaveBeenCalledWith({
        stage: "tiers",
        candidateId: CANDIDATE_ID,
        sourceSlug: "semianalysis",
        rejectionReason: "tier_orchestration_indeterminate",
      });
    });

    it("happy-path success → captureFailure NOT called", async () => {
      mock.queueSelect([snapshotWithSlug("cnbc-markets")]);
      const captureFailure = jest.fn();
      const result = await processEnrichmentJob(
        { candidateId: CANDIDATE_ID },
        {
          db: mock.db,
          seams: {
            runHeuristic: jest.fn().mockResolvedValue(passingHeuristic),
            runRelevanceGate: jest.fn().mockResolvedValue({
              relevant: true,
              sector: "finance",
              reason: "x",
            }),
            extractFacts: jest.fn().mockResolvedValue({
              ok: true,
              facts: { facts: [] },
            }),
          },
          processTier: jest.fn().mockResolvedValue({
            candidateId: CANDIDATE_ID,
            ranTiers: ["accessible", "briefed", "technical"],
            skippedTiers: [],
            failedTier: null,
            completed: true,
          }),
          writeEvent: jest.fn().mockResolvedValue({ eventId: "EVENT_ID" }),
          captureFailure,
        },
      );
      expect(result.terminalStatus).toBe("published");
      expect(captureFailure).not.toHaveBeenCalled();
    });

    it("sourceSlug=null (snapshot join couldn't resolve) → captureFailure called with sourceSlug=null", async () => {
      mock.queueSelect([snapshotWithSlug(null)]);
      const captureFailure = jest.fn();
      await processEnrichmentJob(
        { candidateId: CANDIDATE_ID },
        {
          db: mock.db,
          seams: {
            runHeuristic: jest.fn().mockResolvedValue(passingHeuristic),
            runRelevanceGate: jest.fn().mockResolvedValue({
              relevant: false,
              rejectionReason: "llm_rejected",
            }),
          },
          captureFailure,
        },
      );
      expect(captureFailure).toHaveBeenCalledWith(
        expect.objectContaining({ sourceSlug: null }),
      );
    });

    it("snapshot=null (row missing) → captureFailure still fires with sourceSlug=null", async () => {
      // No snapshot queued → mockDb returns [] → snapshot=null. The
      // captureFailure call must still fire for any stage rejection
      // and gracefully omit/null the slug.
      mock.queueSelect([]);
      const captureFailure = jest.fn();
      await processEnrichmentJob(
        { candidateId: CANDIDATE_ID },
        {
          db: mock.db,
          seams: {
            runHeuristic: jest.fn().mockResolvedValue(passingHeuristic),
            runRelevanceGate: jest.fn().mockResolvedValue({
              relevant: false,
              rejectionReason: "llm_timeout",
            }),
          },
          captureFailure,
        },
      );
      expect(captureFailure).toHaveBeenCalledTimes(1);
      expect(captureFailure).toHaveBeenCalledWith(
        expect.objectContaining({
          stage: "relevance",
          sourceSlug: null,
          rejectionReason: "llm_timeout",
        }),
      );
    });
  });

  describe("12e.6a embedding + cluster check", () => {
    function fakeEmbedding(): number[] {
      return Array(1536).fill(0.5);
    }
    const passingHeuristic = {
      pass: true,
      body: { text: "article body for the test", truncated: false },
    };

    it("embedding success + cluster match → clusterResult.matched=true on result envelope", async () => {
      mock.queueSelect([]); // snapshot (none — fresh candidate)
      const computeEmbedding = jest.fn().mockResolvedValue({
        ok: true,
        embedding: fakeEmbedding(),
      });
      const checkCluster = jest.fn().mockResolvedValue({
        matched: true,
        matchedEventId: "evt-99",
        similarity: 0.91,
      });
      const result = await processEnrichmentJob(
        { candidateId: CANDIDATE_ID },
        {
          db: mock.db,
          seams: {
            runHeuristic: jest.fn().mockResolvedValue(passingHeuristic),
            runRelevanceGate: jest.fn().mockResolvedValue({
              relevant: true,
              sector: "ai",
            }),
            extractFacts: undefined,
            computeEmbedding,
            checkCluster,
          },
        },
      );
      expect(computeEmbedding).toHaveBeenCalledTimes(1);
      expect(checkCluster).toHaveBeenCalledTimes(1);
      expect(result.clusterResult).toEqual({
        matched: true,
        matchedEventId: "evt-99",
        similarity: 0.91,
      });
      // Chain terminates at llm_relevant because extractFacts not wired —
      // confirms the stage ran post-relevance, pre-facts.
      expect(result.terminalStatus).toBe("llm_relevant");
    });

    it("embedding success + no cluster match → clusterResult.matched=false on result envelope", async () => {
      mock.queueSelect([]);
      const computeEmbedding = jest.fn().mockResolvedValue({
        ok: true,
        embedding: fakeEmbedding(),
      });
      const checkCluster = jest.fn().mockResolvedValue({ matched: false });
      const result = await processEnrichmentJob(
        { candidateId: CANDIDATE_ID },
        {
          db: mock.db,
          seams: {
            runHeuristic: jest.fn().mockResolvedValue(passingHeuristic),
            runRelevanceGate: jest.fn().mockResolvedValue({
              relevant: true,
              sector: "ai",
            }),
            extractFacts: undefined,
            computeEmbedding,
            checkCluster,
          },
        },
      );
      expect(checkCluster).toHaveBeenCalledTimes(1);
      expect(result.clusterResult).toEqual({ matched: false });
    });

    it("embedding seam soft-failure → captureFailure fired with stage='embedding'; clusterResult absent; chain continues to facts", async () => {
      mock.queueSelect([]);
      const captureFailure = jest.fn();
      const computeEmbedding = jest.fn().mockResolvedValue({
        ok: false,
        rejectionReason: "embedding_api_error",
      });
      const checkCluster = jest.fn();
      const extractFacts = jest.fn().mockResolvedValue({
        ok: true,
        facts: { facts: [] },
      });
      const result = await processEnrichmentJob(
        { candidateId: CANDIDATE_ID },
        {
          db: mock.db,
          seams: {
            runHeuristic: jest.fn().mockResolvedValue(passingHeuristic),
            runRelevanceGate: jest.fn().mockResolvedValue({
              relevant: true,
              sector: "ai",
            }),
            extractFacts,
            computeEmbedding,
            checkCluster,
          },
          captureFailure,
        },
      );
      expect(computeEmbedding).toHaveBeenCalledTimes(1);
      expect(checkCluster).not.toHaveBeenCalled();
      expect(extractFacts).toHaveBeenCalledTimes(1);
      expect(captureFailure).toHaveBeenCalledWith(
        expect.objectContaining({
          stage: "embedding",
          rejectionReason: "embedding_api_error",
        }),
      );
      expect(result.clusterResult).toBeUndefined();
      expect(result.terminalStatus).toBe("facts_extracted");
    });

    it("re-enqueue at facts_extracted snapshot → embedding stage skipped (no embedding seam call)", async () => {
      // Mirrors the heuristic short-circuit pattern from fix #65: a
      // re-enqueued candidate that already has facts persisted should not
      // re-fire the embedding stage. The whole-job snapshot vintage check
      // gates this.
      mock.queueSelect([
        {
          status: "facts_extracted",
          statusReason: null,
          llmJudgmentRaw: { fake: true },
          factsExtractedAt: new Date("2026-04-28T00:00:00Z"),
          tierOutputs: null,
          resolvedEventId: null,
        },
      ]);
      const computeEmbedding = jest.fn();
      const checkCluster = jest.fn();
      const processTier = jest.fn().mockResolvedValue({
        candidateId: CANDIDATE_ID,
        ranTiers: ["accessible", "briefed", "technical"],
        skippedTiers: [],
        failedTier: null,
        completed: true,
      });
      const writeEventMock = jest
        .fn()
        .mockResolvedValue({ eventId: "EVENT_ID" });
      await processEnrichmentJob(
        { candidateId: CANDIDATE_ID },
        {
          db: mock.db,
          seams: {
            runHeuristic: jest.fn(),
            runRelevanceGate: jest.fn(),
            extractFacts: jest.fn(),
            computeEmbedding,
            checkCluster,
          },
          processTier,
          writeEvent: writeEventMock,
        },
      );
      expect(computeEmbedding).not.toHaveBeenCalled();
      expect(checkCluster).not.toHaveBeenCalled();
    });

    it("opt-out: no openai + no computeEmbedding seam → embedding stage silently skipped (no captureFailure)", async () => {
      mock.queueSelect([]);
      const captureFailure = jest.fn();
      await processEnrichmentJob(
        { candidateId: CANDIDATE_ID },
        {
          db: mock.db,
          seams: {
            runHeuristic: jest.fn().mockResolvedValue(passingHeuristic),
            runRelevanceGate: jest.fn().mockResolvedValue({
              relevant: true,
              sector: "ai",
            }),
            // extractFacts not wired → terminate at llm_relevant
          },
          openai: null,
          captureFailure,
        },
      );
      // captureFailure should NOT include any stage='embedding' call.
      const embeddingCalls = captureFailure.mock.calls.filter(
        (args: unknown[]) =>
          (args[0] as { stage?: string } | undefined)?.stage === "embedding",
      );
      expect(embeddingCalls).toHaveLength(0);
    });
  });
});
