/* eslint-disable @typescript-eslint/no-explicit-any */
import { createMockDb, type MockDb } from "../helpers/mockDb";
import { FACTS_REASONS } from "../../src/jobs/ingestion/factsSeam";
import type { HaikuResult } from "../../src/services/haikuCommentaryClient";

let mock: MockDb;
jest.mock("../../src/db", () => ({
  get db() {
    return mock.db;
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const { runFactsSeam } = require("../../src/jobs/ingestion/factsSeam");

const CANDIDATE_ID = "00000000-0000-0000-0000-0000000000ee";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CANDIDATE_ID,
    rawTitle: "TSMC reports Q1 results above estimates",
    bodyText:
      "TSMC reported Q1 2026 revenue of $24.6B, up 58% year-over-year on AI demand. CEO C.C. Wei said HPC demand drove the beat. Gross margin expanded 220bps to 53.1%. The company guided Q2 revenue to $26.5B, above consensus of $25.1B.",
    sector: "semiconductors",
    ...overrides,
  };
}

const VALID_FACTS_JSON =
  '{"facts":[{"text":"TSMC reported Q1 2026 revenue of $24.6B.","category":"metric"},{"text":"Revenue grew 58% year-over-year.","category":"metric"},{"text":"CEO C.C. Wei attributed the beat to HPC demand.","category":"actor"},{"text":"Gross margin expanded 220bps to 53.1%.","category":"metric"},{"text":"Q2 guidance of $26.5B was issued.","category":"timeframe"}]}';

function ok(text: string): jest.Mock<Promise<HaikuResult>, []> {
  return jest.fn().mockResolvedValue({ ok: true, text });
}

function fail(reason: string, detail?: string): jest.Mock<Promise<HaikuResult>, []> {
  return jest.fn().mockResolvedValue({ ok: false, reason, detail });
}

function fixedClock(values: number[]): () => Date {
  let i = 0;
  return () => new Date(values[i++ % values.length]!);
}

beforeEach(() => {
  mock = createMockDb();
});

describe("runFactsSeam", () => {
  describe("missing candidate", () => {
    it("returns FACTS_PARSE_ERROR without calling Haiku", async () => {
      mock.queueSelect([]);
      const callHaiku = ok(VALID_FACTS_JSON);
      const r = await runFactsSeam(CANDIDATE_ID, { callHaiku });
      expect(r.ok).toBe(false);
      expect(r.rejectionReason).toBe(FACTS_REASONS.FACTS_PARSE_ERROR);
      expect(callHaiku).not.toHaveBeenCalled();
      expect(r.raw).toBeUndefined();
    });
  });

  describe("invalid sector on candidate (upstream contract violation)", () => {
    it("returns FACTS_PARSE_ERROR without calling Haiku", async () => {
      mock.queueSelect([makeRow({ sector: "biotech" })]);
      const callHaiku = ok(VALID_FACTS_JSON);
      const r = await runFactsSeam(CANDIDATE_ID, { callHaiku });
      expect(r.ok).toBe(false);
      expect(r.rejectionReason).toBe(FACTS_REASONS.FACTS_PARSE_ERROR);
      expect(callHaiku).not.toHaveBeenCalled();
    });

    it("returns FACTS_PARSE_ERROR when sector is null", async () => {
      mock.queueSelect([makeRow({ sector: null })]);
      const callHaiku = ok(VALID_FACTS_JSON);
      const r = await runFactsSeam(CANDIDATE_ID, { callHaiku });
      expect(r.ok).toBe(false);
      expect(r.rejectionReason).toBe(FACTS_REASONS.FACTS_PARSE_ERROR);
      expect(callHaiku).not.toHaveBeenCalled();
    });
  });

  describe("LLM-level failures (no retry)", () => {
    it.each([
      ["timeout", undefined, FACTS_REASONS.FACTS_TIMEOUT],
      ["no_api_key", undefined, FACTS_REASONS.FACTS_NO_API_KEY],
      ["empty", undefined, FACTS_REASONS.FACTS_EMPTY],
      ["api_error", "generic upstream error", FACTS_REASONS.FACTS_API_ERROR],
      ["api_error", "HTTP 429: rate_limit_exceeded", FACTS_REASONS.FACTS_RATE_LIMITED],
      ["api_error", "rate limited by provider", FACTS_REASONS.FACTS_RATE_LIMITED],
    ])("%s with detail %s → %s", async (haikuReason, detail, expectedReason) => {
      mock.queueSelect([makeRow()]);
      const callHaiku = fail(haikuReason, detail);
      const r = await runFactsSeam(CANDIDATE_ID, { callHaiku });
      expect(r.ok).toBe(false);
      expect(r.rejectionReason).toBe(expectedReason);
      expect(callHaiku).toHaveBeenCalledTimes(1); // no retry
      expect(r.raw).toBeUndefined(); // no raw — call never returned text
    });
  });

  describe("first-attempt success", () => {
    it("valid facts payload → returns ok=true + raw, attempts=1", async () => {
      mock.queueSelect([makeRow()]);
      const callHaiku = ok(VALID_FACTS_JSON);
      const now = fixedClock([1000, 1500]); // 500ms elapsed
      const r = await runFactsSeam(CANDIDATE_ID, { callHaiku, now });
      expect(r.ok).toBe(true);
      expect(r.facts?.facts).toHaveLength(5);
      expect(r.facts?.facts[0]).toEqual({
        text: "TSMC reported Q1 2026 revenue of $24.6B.",
        category: "metric",
      });
      expect(r.rejectionReason).toBeUndefined();
      expect(r.raw?.attempts).toBe(1);
      expect(r.raw?.responseText).toBe(VALID_FACTS_JSON);
      expect(r.raw?.latencyMs).toBe(500);
      expect(r.raw?.model).toBe("claude-haiku-4-5-20251001");
      expect(callHaiku).toHaveBeenCalledTimes(1);
    });

    it("8-fact payload at the upper bound parses cleanly", async () => {
      mock.queueSelect([makeRow()]);
      const facts = Array.from({ length: 8 }, (_, i) => ({
        text: `Fact number ${i} stated as a sentence.`,
        category: "context",
      }));
      const text = JSON.stringify({ facts });
      const callHaiku = ok(text);
      const r = await runFactsSeam(CANDIDATE_ID, { callHaiku });
      expect(r.ok).toBe(true);
      expect(r.facts?.facts).toHaveLength(8);
    });

    it("uses default prefill `{` on first attempt", async () => {
      mock.queueSelect([makeRow()]);
      const callHaiku = jest
        .fn()
        .mockResolvedValue({ ok: true, text: VALID_FACTS_JSON });
      await runFactsSeam(CANDIDATE_ID, { callHaiku });
      const firstCall = callHaiku.mock.calls[0]!;
      expect((firstCall[1] as any).assistantPrefill).toBe("{");
    });
  });

  describe("retry path — first attempt malformed, second succeeds", () => {
    it("malformed JSON → retry with strict prefill → success, attempts=2", async () => {
      mock.queueSelect([makeRow()]);
      const callHaiku = jest
        .fn()
        .mockResolvedValueOnce({ ok: true, text: 'not json' })
        .mockResolvedValueOnce({ ok: true, text: VALID_FACTS_JSON });
      const r = await runFactsSeam(CANDIDATE_ID, { callHaiku });
      expect(callHaiku).toHaveBeenCalledTimes(2);
      expect(r.ok).toBe(true);
      expect(r.facts?.facts).toHaveLength(5);
      expect(r.raw?.attempts).toBe(2);
    });

    it("retry uses stricter prefill on second call", async () => {
      mock.queueSelect([makeRow()]);
      const callHaiku = jest
        .fn()
        .mockResolvedValueOnce({ ok: true, text: 'not json' })
        .mockResolvedValueOnce({ ok: true, text: VALID_FACTS_JSON });
      await runFactsSeam(CANDIDATE_ID, { callHaiku });
      const firstCall = callHaiku.mock.calls[0]!;
      const secondCall = callHaiku.mock.calls[1]!;
      expect((firstCall[1] as any).assistantPrefill).toBe("{");
      expect((secondCall[1] as any).assistantPrefill).toBe('{"facts":');
    });

    it("Zod-invalid first attempt (4 facts, below floor) triggers retry", async () => {
      mock.queueSelect([makeRow()]);
      const tooFewFacts = JSON.stringify({
        facts: Array.from({ length: 4 }, (_, i) => ({
          text: `Fact ${i} of four.`,
          category: "context",
        })),
      });
      const callHaiku = jest
        .fn()
        .mockResolvedValueOnce({ ok: true, text: tooFewFacts })
        .mockResolvedValueOnce({ ok: true, text: VALID_FACTS_JSON });
      const r = await runFactsSeam(CANDIDATE_ID, { callHaiku });
      expect(callHaiku).toHaveBeenCalledTimes(2);
      expect(r.ok).toBe(true);
    });

    it("Zod-invalid first attempt (9 facts, above ceiling) triggers retry", async () => {
      mock.queueSelect([makeRow()]);
      const tooManyFacts = JSON.stringify({
        facts: Array.from({ length: 9 }, (_, i) => ({
          text: `Fact ${i} of nine.`,
          category: "context",
        })),
      });
      const callHaiku = jest
        .fn()
        .mockResolvedValueOnce({ ok: true, text: tooManyFacts })
        .mockResolvedValueOnce({ ok: true, text: VALID_FACTS_JSON });
      const r = await runFactsSeam(CANDIDATE_ID, { callHaiku });
      expect(callHaiku).toHaveBeenCalledTimes(2);
      expect(r.ok).toBe(true);
    });

    it("Zod-invalid first attempt (extra per-fact field) triggers retry", async () => {
      mock.queueSelect([makeRow()]);
      const extraField = JSON.stringify({
        facts: Array.from({ length: 5 }, (_, i) => ({
          text: `Fact ${i} with an extra field.`,
          category: "context",
          confidence: 0.9, // .strict() rejects
        })),
      });
      const callHaiku = jest
        .fn()
        .mockResolvedValueOnce({ ok: true, text: extraField })
        .mockResolvedValueOnce({ ok: true, text: VALID_FACTS_JSON });
      const r = await runFactsSeam(CANDIDATE_ID, { callHaiku });
      expect(callHaiku).toHaveBeenCalledTimes(2);
      expect(r.ok).toBe(true);
    });

    it("Zod-invalid first attempt (text too short) triggers retry", async () => {
      mock.queueSelect([makeRow()]);
      const shortText = JSON.stringify({
        facts: Array.from({ length: 5 }, () => ({
          text: "short", // < 10 chars
          category: "context",
        })),
      });
      const callHaiku = jest
        .fn()
        .mockResolvedValueOnce({ ok: true, text: shortText })
        .mockResolvedValueOnce({ ok: true, text: VALID_FACTS_JSON });
      const r = await runFactsSeam(CANDIDATE_ID, { callHaiku });
      expect(callHaiku).toHaveBeenCalledTimes(2);
      expect(r.ok).toBe(true);
    });
  });

  describe("retry path — terminal FACTS_PARSE_ERROR", () => {
    it("malformed JSON twice → FACTS_PARSE_ERROR with attempts=2", async () => {
      mock.queueSelect([makeRow()]);
      const callHaiku = jest
        .fn()
        .mockResolvedValueOnce({ ok: true, text: '{"broken":' })
        .mockResolvedValueOnce({ ok: true, text: 'still not json' });
      const r = await runFactsSeam(CANDIDATE_ID, { callHaiku });
      expect(r.ok).toBe(false);
      expect(r.rejectionReason).toBe(FACTS_REASONS.FACTS_PARSE_ERROR);
      expect(r.raw?.attempts).toBe(2);
      expect(callHaiku).toHaveBeenCalledTimes(2);
      // Recorded responseText is the second attempt's bytes (most recent).
      expect(r.raw?.responseText).toBe("still not json");
    });

    it("first parse fails, second client-fails → FACTS_PARSE_ERROR (parse error wins)", async () => {
      mock.queueSelect([makeRow()]);
      const callHaiku = jest
        .fn()
        .mockResolvedValueOnce({ ok: true, text: 'garbled' })
        .mockResolvedValueOnce({ ok: false, reason: "timeout" });
      const r = await runFactsSeam(CANDIDATE_ID, { callHaiku });
      expect(r.rejectionReason).toBe(FACTS_REASONS.FACTS_PARSE_ERROR);
      expect(r.raw?.attempts).toBe(2);
      // First attempt's bytes recorded — the parse-failing one is the
      // diagnostic signal when attempt 2 was a transport failure.
      expect(r.raw?.responseText).toBe("garbled");
    });

    it("Zod-invalid twice → FACTS_PARSE_ERROR", async () => {
      mock.queueSelect([makeRow()]);
      const tooFew1 = JSON.stringify({
        facts: [{ text: "a single fact only.", category: "context" }],
      });
      const tooFew2 = JSON.stringify({
        facts: [{ text: "still just one fact.", category: "context" }],
      });
      const callHaiku = jest
        .fn()
        .mockResolvedValueOnce({ ok: true, text: tooFew1 })
        .mockResolvedValueOnce({ ok: true, text: tooFew2 });
      const r = await runFactsSeam(CANDIDATE_ID, { callHaiku });
      expect(r.ok).toBe(false);
      expect(r.rejectionReason).toBe(FACTS_REASONS.FACTS_PARSE_ERROR);
      expect(callHaiku).toHaveBeenCalledTimes(2);
    });
  });

  describe("audit blob (raw) on every text-producing outcome", () => {
    it("populates raw on first-attempt success", async () => {
      mock.queueSelect([makeRow()]);
      const callHaiku = ok(VALID_FACTS_JSON);
      const r = await runFactsSeam(CANDIDATE_ID, { callHaiku });
      expect(r.raw).toBeDefined();
      expect(r.raw?.promptText).toContain("Title:");
      expect(r.raw?.responseText).toBe(VALID_FACTS_JSON);
      expect(r.raw?.attempts).toBe(1);
    });

    it("populates raw on retry success (attempts=2)", async () => {
      mock.queueSelect([makeRow()]);
      const callHaiku = jest
        .fn()
        .mockResolvedValueOnce({ ok: true, text: 'garbled' })
        .mockResolvedValueOnce({ ok: true, text: VALID_FACTS_JSON });
      const r = await runFactsSeam(CANDIDATE_ID, { callHaiku });
      expect(r.raw?.attempts).toBe(2);
      expect(r.raw?.responseText).toBe(VALID_FACTS_JSON);
    });

    it("populates raw on terminal FACTS_PARSE_ERROR (both text)", async () => {
      mock.queueSelect([makeRow()]);
      const callHaiku = jest
        .fn()
        .mockResolvedValueOnce({ ok: true, text: 'a' })
        .mockResolvedValueOnce({ ok: true, text: 'b' });
      const r = await runFactsSeam(CANDIDATE_ID, { callHaiku });
      expect(r.raw?.attempts).toBe(2);
    });

    it("does NOT populate raw on transport-class first-attempt failure", async () => {
      mock.queueSelect([makeRow()]);
      const callHaiku = fail("timeout");
      const r = await runFactsSeam(CANDIDATE_ID, { callHaiku });
      expect(r.raw).toBeUndefined();
    });
  });

  describe("latency tracking", () => {
    it("records single-call latency on attempt 1 success", async () => {
      mock.queueSelect([makeRow()]);
      const callHaiku = ok(VALID_FACTS_JSON);
      const now = fixedClock([10000, 10750]);
      const r = await runFactsSeam(CANDIDATE_ID, { callHaiku, now });
      expect(r.raw?.latencyMs).toBe(750);
    });

    it("records combined latency across two attempts", async () => {
      mock.queueSelect([makeRow()]);
      const callHaiku = jest
        .fn()
        .mockResolvedValueOnce({ ok: true, text: 'garbage' })
        .mockResolvedValueOnce({ ok: true, text: VALID_FACTS_JSON });
      const now = fixedClock([0, 500, 500, 1200]); // 500 + 700 = 1200
      const r = await runFactsSeam(CANDIDATE_ID, { callHaiku, now });
      expect(r.raw?.latencyMs).toBe(1200);
      expect(r.raw?.attempts).toBe(2);
    });
  });

  describe("logging", () => {
    it("logs success with fact_count + latency + attempts", async () => {
      mock.queueSelect([makeRow()]);
      const callHaiku = ok(VALID_FACTS_JSON);
      const logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
      try {
        await runFactsSeam(CANDIDATE_ID, { callHaiku });
        const entry = logSpy.mock.calls.find((c) =>
          String(c[0]).includes("[ingestion-facts]"),
        );
        expect(entry).toBeDefined();
        expect(String(entry![0])).toContain("ok=true");
        expect(String(entry![0])).toContain("fact_count=5");
      } finally {
        logSpy.mockRestore();
      }
    });

    it("logs warning on rejection", async () => {
      mock.queueSelect([makeRow()]);
      const callHaiku = fail("timeout");
      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
      try {
        await runFactsSeam(CANDIDATE_ID, { callHaiku });
        const entry = warnSpy.mock.calls.find((c) =>
          String(c[0]).includes("[ingestion-facts]"),
        );
        expect(entry).toBeDefined();
        expect(String(entry![0])).toContain("rejected");
        expect(String(entry![0])).toContain("facts_timeout");
      } finally {
        warnSpy.mockRestore();
      }
    });
  });
});
