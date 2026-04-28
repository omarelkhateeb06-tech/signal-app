/* eslint-disable @typescript-eslint/no-explicit-any */
import { createMockDb, type MockDb } from "../helpers/mockDb";
import { RELEVANCE_REASONS } from "../../src/jobs/ingestion/relevanceSeam";
import type { HaikuResult } from "../../src/services/haikuCommentaryClient";

let mock: MockDb;
jest.mock("../../src/db", () => ({
  get db() {
    return mock.db;
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const { runRelevanceSeam } = require("../../src/jobs/ingestion/relevanceSeam");

const CANDIDATE_ID = "00000000-0000-0000-0000-0000000000dd";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CANDIDATE_ID,
    rawTitle: "TSMC reports Q1 results above estimates",
    bodyText: "TSMC's Q1 earnings beat consensus. Revenue rose 58% on AI demand.",
    ...overrides,
  };
}

function ok(text: string): jest.Mock<Promise<HaikuResult>, []> {
  return jest.fn().mockResolvedValue({ ok: true, text });
}

function fail(reason: string, detail?: string): jest.Mock<Promise<HaikuResult>, []> {
  return jest.fn().mockResolvedValue({ ok: false, reason, detail });
}

// Deterministic clock for latency assertions.
function fixedClock(values: number[]): () => Date {
  let i = 0;
  return () => new Date(values[i++ % values.length]!);
}

beforeEach(() => {
  mock = createMockDb();
});

describe("runRelevanceSeam", () => {
  describe("missing candidate", () => {
    it("returns LLM_REJECTED with reason='candidate not found'", async () => {
      mock.queueSelect([]); // candidate not found
      const callHaiku = ok('{"relevant":true,"sector":"ai","reason":"x"}');
      const r = await runRelevanceSeam(CANDIDATE_ID, { callHaiku });
      expect(r.relevant).toBe(false);
      expect(r.rejectionReason).toBe(RELEVANCE_REASONS.LLM_REJECTED);
      expect(r.reason).toBe("candidate not found");
      expect(callHaiku).not.toHaveBeenCalled();
    });
  });

  describe("LLM-level failures (no retry)", () => {
    it.each([
      ["timeout", undefined, RELEVANCE_REASONS.LLM_TIMEOUT],
      ["no_api_key", undefined, RELEVANCE_REASONS.LLM_NO_API_KEY],
      ["empty", undefined, RELEVANCE_REASONS.LLM_EMPTY],
      ["api_error", "generic upstream error", RELEVANCE_REASONS.LLM_API_ERROR],
      ["api_error", "HTTP 429: rate_limit_exceeded", RELEVANCE_REASONS.LLM_RATE_LIMITED],
      ["api_error", "rate limited by provider", RELEVANCE_REASONS.LLM_RATE_LIMITED],
    ])("%s with detail %s → %s", async (haikuReason, detail, expectedReason) => {
      mock.queueSelect([makeRow()]);
      const callHaiku = fail(haikuReason, detail);
      const r = await runRelevanceSeam(CANDIDATE_ID, { callHaiku });
      expect(r.relevant).toBe(false);
      expect(r.rejectionReason).toBe(expectedReason);
      expect(callHaiku).toHaveBeenCalledTimes(1); // no retry
      expect(r.raw).toBeUndefined(); // no raw — call never returned text
    });
  });

  describe("first-attempt success branches", () => {
    it("relevant=true with valid sector → returns judgment + raw, attempts=1", async () => {
      mock.queueSelect([makeRow()]);
      const text = '{"relevant":true,"sector":"semiconductors","reason":"TSMC earnings"}';
      const callHaiku = ok(text);
      const now = fixedClock([1000, 1500]); // 500ms elapsed
      const r = await runRelevanceSeam(CANDIDATE_ID, { callHaiku, now });
      expect(r.relevant).toBe(true);
      expect(r.sector).toBe("semiconductors");
      expect(r.reason).toBe("TSMC earnings");
      expect(r.rejectionReason).toBeUndefined();
      expect(r.raw?.attempts).toBe(1);
      expect(r.raw?.responseText).toBe(text);
      expect(r.raw?.latencyMs).toBe(500);
      expect(callHaiku).toHaveBeenCalledTimes(1);
    });

    it("relevant=false → returns rejection with raw, attempts=1, sector ignored", async () => {
      mock.queueSelect([makeRow()]);
      const text = '{"relevant":false,"reason":"sports content, off-topic"}';
      const callHaiku = ok(text);
      const r = await runRelevanceSeam(CANDIDATE_ID, { callHaiku });
      expect(r.relevant).toBe(false);
      expect(r.rejectionReason).toBe(RELEVANCE_REASONS.LLM_REJECTED);
      expect(r.reason).toBe("sports content, off-topic");
      expect(r.sector).toBeUndefined();
      expect(r.raw?.attempts).toBe(1);
      expect(callHaiku).toHaveBeenCalledTimes(1);
    });

    it("relevant=false with sector present → sector still NOT returned (G5)", async () => {
      mock.queueSelect([makeRow()]);
      const text = '{"relevant":false,"sector":"ai","reason":"too generic"}';
      const callHaiku = ok(text);
      const r = await runRelevanceSeam(CANDIDATE_ID, { callHaiku });
      expect(r.relevant).toBe(false);
      expect(r.sector).toBeUndefined();
    });
  });

  describe("retry path — relevant=true with missing/invalid sector triggers retry", () => {
    it("missing sector on relevant=true → retry succeeds", async () => {
      mock.queueSelect([makeRow()]);
      const callHaiku = jest
        .fn()
        .mockResolvedValueOnce({ ok: true, text: '{"relevant":true,"reason":"missing sector"}' })
        .mockResolvedValueOnce({
          ok: true,
          text: '{"relevant":true,"sector":"ai","reason":"AI lab launch"}',
        });
      const r = await runRelevanceSeam(CANDIDATE_ID, { callHaiku });
      expect(callHaiku).toHaveBeenCalledTimes(2);
      expect(r.relevant).toBe(true);
      expect(r.sector).toBe("ai");
      expect(r.raw?.attempts).toBe(2);
    });

    it("invalid sector ('other') triggers retry", async () => {
      mock.queueSelect([makeRow()]);
      const callHaiku = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          text: '{"relevant":true,"sector":"other","reason":"x"}',
        })
        .mockResolvedValueOnce({
          ok: true,
          text: '{"relevant":true,"sector":"finance","reason":"banking m&a"}',
        });
      const r = await runRelevanceSeam(CANDIDATE_ID, { callHaiku });
      expect(callHaiku).toHaveBeenCalledTimes(2);
      expect(r.sector).toBe("finance");
      expect(r.raw?.attempts).toBe(2);
    });

    it("retry uses stricter prefill on second call", async () => {
      mock.queueSelect([makeRow()]);
      const callHaiku = jest
        .fn()
        .mockResolvedValueOnce({ ok: true, text: 'not json' })
        .mockResolvedValueOnce({
          ok: true,
          text: '{"relevant":true,"sector":"ai","reason":"ok"}',
        });
      await runRelevanceSeam(CANDIDATE_ID, { callHaiku });
      const firstCall = callHaiku.mock.calls[0]!;
      const secondCall = callHaiku.mock.calls[1]!;
      expect(firstCall[1].assistantPrefill).toBe("{");
      expect(secondCall[1].assistantPrefill).toBe('{"relevant":');
    });
  });

  describe("retry path — terminal LLM_PARSE_ERROR", () => {
    it("malformed JSON twice → LLM_PARSE_ERROR with attempts=2", async () => {
      mock.queueSelect([makeRow()]);
      const callHaiku = jest
        .fn()
        .mockResolvedValueOnce({ ok: true, text: '{"broken":' })
        .mockResolvedValueOnce({ ok: true, text: 'still not json' });
      const r = await runRelevanceSeam(CANDIDATE_ID, { callHaiku });
      expect(r.relevant).toBe(false);
      expect(r.rejectionReason).toBe(RELEVANCE_REASONS.LLM_PARSE_ERROR);
      expect(r.raw?.attempts).toBe(2);
      expect(callHaiku).toHaveBeenCalledTimes(2);
    });

    it("first parse fails, second client-fails → LLM_PARSE_ERROR (parse error wins)", async () => {
      mock.queueSelect([makeRow()]);
      const callHaiku = jest
        .fn()
        .mockResolvedValueOnce({ ok: true, text: 'garbled' })
        .mockResolvedValueOnce({ ok: false, reason: "timeout" });
      const r = await runRelevanceSeam(CANDIDATE_ID, { callHaiku });
      expect(r.rejectionReason).toBe(RELEVANCE_REASONS.LLM_PARSE_ERROR);
      expect(r.raw?.attempts).toBe(2);
      // Recorded responseText is the first attempt's bytes (the parse-failing one).
      expect(r.raw?.responseText).toBe("garbled");
    });

    it("second-attempt valid but still missing sector → LLM_PARSE_ERROR", async () => {
      mock.queueSelect([makeRow()]);
      const callHaiku = jest
        .fn()
        .mockResolvedValueOnce({ ok: true, text: '{"relevant":true,"reason":"x"}' })
        .mockResolvedValueOnce({ ok: true, text: '{"relevant":true,"reason":"still no sector"}' });
      const r = await runRelevanceSeam(CANDIDATE_ID, { callHaiku });
      expect(r.rejectionReason).toBe(RELEVANCE_REASONS.LLM_PARSE_ERROR);
      expect(callHaiku).toHaveBeenCalledTimes(2);
    });
  });

  describe("latency tracking", () => {
    it("records single-call latency on attempt 1 success", async () => {
      mock.queueSelect([makeRow()]);
      const callHaiku = ok('{"relevant":true,"sector":"ai","reason":"x"}');
      const now = fixedClock([10000, 10750]); // 750ms
      const r = await runRelevanceSeam(CANDIDATE_ID, { callHaiku, now });
      expect(r.raw?.latencyMs).toBe(750);
    });

    it("records combined latency across two attempts", async () => {
      mock.queueSelect([makeRow()]);
      const callHaiku = jest
        .fn()
        .mockResolvedValueOnce({ ok: true, text: 'garbage' })
        .mockResolvedValueOnce({
          ok: true,
          text: '{"relevant":true,"sector":"ai","reason":"x"}',
        });
      const now = fixedClock([0, 500, 500, 1200]); // 500 + 700 = 1200
      const r = await runRelevanceSeam(CANDIDATE_ID, { callHaiku, now });
      expect(r.raw?.latencyMs).toBe(1200);
      expect(r.raw?.attempts).toBe(2);
    });
  });

  describe("logging", () => {
    it("logs success with relevant + sector + latency + attempts", async () => {
      mock.queueSelect([makeRow()]);
      const callHaiku = ok('{"relevant":true,"sector":"ai","reason":"x"}');
      const logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
      try {
        await runRelevanceSeam(CANDIDATE_ID, { callHaiku });
        const entry = logSpy.mock.calls.find((c) =>
          String(c[0]).includes("[ingestion-llm-relevance]"),
        );
        expect(entry).toBeDefined();
        expect(String(entry![0])).toContain("relevant=true");
        expect(String(entry![0])).toContain("sector=ai");
      } finally {
        logSpy.mockRestore();
      }
    });

    it("logs warning on rejection", async () => {
      mock.queueSelect([makeRow()]);
      const callHaiku = fail("timeout");
      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
      try {
        await runRelevanceSeam(CANDIDATE_ID, { callHaiku });
        const entry = warnSpy.mock.calls.find((c) =>
          String(c[0]).includes("[ingestion-llm-relevance]"),
        );
        expect(entry).toBeDefined();
        expect(String(entry![0])).toContain("rejected");
        expect(String(entry![0])).toContain("llm_timeout");
      } finally {
        warnSpy.mockRestore();
      }
    });
  });
});
