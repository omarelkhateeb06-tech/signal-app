/* eslint-disable @typescript-eslint/no-explicit-any */
import { createMockDb, type MockDb } from "../helpers/mockDb";
import { TIER_REASONS } from "../../src/jobs/ingestion/tierGenerationSeam";
import type { HaikuResult } from "../../src/services/haikuCommentaryClient";
import type { TierName } from "../../src/services/haikuTierClient";

let mock: MockDb;
jest.mock("../../src/db", () => ({
  get db() {
    return mock.db;
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const { runTierGenerationSeam } = require("../../src/jobs/ingestion/tierGenerationSeam");

const CANDIDATE_ID = "00000000-0000-0000-0000-0000000000ff";

const FACTS_OBJ = {
  facts: [
    { text: "TSMC reported Q1 2026 revenue of $24.6B.", category: "metric" },
    { text: "Revenue grew 58% year-over-year.", category: "metric" },
    { text: "CEO C.C. Wei attributed the beat to HPC demand.", category: "actor" },
    { text: "Gross margin expanded 220bps to 53.1%.", category: "metric" },
    { text: "Q2 guidance of $26.5B was issued.", category: "timeframe" },
  ],
};

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CANDIDATE_ID,
    rawTitle: "TSMC reports Q1 results above estimates",
    bodyText:
      "TSMC reported Q1 2026 revenue of $24.6B, up 58% year-over-year on AI demand. CEO C.C. Wei said HPC demand drove the beat. Gross margin expanded 220bps to 53.1%. The company guided Q2 revenue to $26.5B, above consensus of $25.1B.",
    sector: "semiconductors",
    facts: FACTS_OBJ,
    status: "facts_extracted",
    ...overrides,
  };
}

const VALID_TIER_JSON = JSON.stringify({
  thesis:
    "TSMC's Q1 beat highlights how AI-driven HPC demand has shifted from bonus revenue to the dominant growth driver, expanding both volume and margin profile. The 220bps gross margin lift signals capacity utilization that is unlikely to reverse in the short term.",
  support:
    "Revenue growth of 58% year-over-year would be impressive on its own; pairing it with a 220bps gross margin expansion to 53.1% is the more diagnostic signal — capacity is binding, not slack. CEO Wei pinning the result on HPC demand keeps the AI narrative anchored to a single category, which makes the demand profile easier to underwrite. Q2 guidance of $26.5B above consensus reinforces that bookings already reflect what Q1's revenue is. For investors, the binding constraint moves from order book to wafer capacity.",
});

function ok(text: string): jest.Mock {
  return jest.fn<Promise<HaikuResult>, any[]>().mockResolvedValue({ ok: true, text });
}

function fail(reason: string, detail?: string): jest.Mock {
  return jest
    .fn<Promise<HaikuResult>, any[]>()
    .mockResolvedValue({ ok: false, reason: reason as any, detail });
}

function fixedClock(values: number[]): () => Date {
  let i = 0;
  return () => new Date(values[i++ % values.length]!);
}

beforeEach(() => {
  mock = createMockDb();
});

describe("runTierGenerationSeam", () => {
  describe("happy path per tier", () => {
    it.each<[TierName]>([["accessible"], ["briefed"], ["technical"]])(
      "tier=%s — valid JSON → ok=true, attempts=1",
      async (tier) => {
        mock.queueSelect([makeRow()]);
        const haikuClient = ok(VALID_TIER_JSON);
        const r = await runTierGenerationSeam(CANDIDATE_ID, tier, {
          haikuClient,
        });
        expect(r.ok).toBe(true);
        expect(r.tier).toBe(tier);
        expect(r.attempts).toBe(1);
        expect(r.output).toBeDefined();
        expect(r.output.thesis).toContain("TSMC");
        expect(r.output.support.length).toBeGreaterThan(50);
        expect(haikuClient).toHaveBeenCalledTimes(1);
        // tier name passed as 2nd arg to haiku client.
        expect(haikuClient.mock.calls[0]![1]).toBe(tier);
      },
    );

    it("uses default prefill `{` on first attempt", async () => {
      mock.queueSelect([makeRow()]);
      const haikuClient = ok(VALID_TIER_JSON);
      await runTierGenerationSeam(CANDIDATE_ID, "accessible", { haikuClient });
      const firstCall = haikuClient.mock.calls[0]!;
      expect((firstCall[2] as any).prefill).toBe("{");
    });

    it("populates raw audit blob on success", async () => {
      mock.queueSelect([makeRow()]);
      const haikuClient = ok(VALID_TIER_JSON);
      const now = fixedClock([1000, 1500]);
      const r = await runTierGenerationSeam(CANDIDATE_ID, "briefed", {
        haikuClient,
        now,
      });
      expect(r.ok).toBe(true);
      expect(r.raw).toBeDefined();
      expect(r.raw!.attempts).toBe(1);
      expect(r.raw!.responseText).toBe(VALID_TIER_JSON);
      expect(r.raw!.latencyMs).toBe(500);
      expect(r.raw!.model).toBe("claude-haiku-4-5-20251001");
      expect(r.raw!.promptText).toContain("Title:");
    });
  });

  describe("LLM-level failures (no retry)", () => {
    it.each([
      ["timeout", undefined, TIER_REASONS.TIER_TIMEOUT],
      ["no_api_key", undefined, TIER_REASONS.TIER_NO_API_KEY],
      ["empty", undefined, TIER_REASONS.TIER_EMPTY],
      ["api_error", "generic upstream error", TIER_REASONS.TIER_API_ERROR],
      ["api_error", "HTTP 429: rate_limit_exceeded", TIER_REASONS.TIER_RATE_LIMITED],
      ["api_error", "rate limited by provider", TIER_REASONS.TIER_RATE_LIMITED],
    ])("%s with detail %s → %s", async (haikuReason, detail, expectedReason) => {
      mock.queueSelect([makeRow()]);
      const haikuClient = fail(haikuReason, detail);
      const r = await runTierGenerationSeam(CANDIDATE_ID, "accessible", {
        haikuClient,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.rejectionReason).toBe(expectedReason);
        expect(r.attempts).toBe(1);
        expect(r.raw).toBeUndefined();
      }
      expect(haikuClient).toHaveBeenCalledTimes(1); // no retry
    });
  });

  describe("retry path — first attempt malformed, second succeeds", () => {
    it("malformed JSON → retry with strict prefill → success, attempts=2", async () => {
      mock.queueSelect([makeRow()]);
      const haikuClient = jest
        .fn()
        .mockResolvedValueOnce({ ok: true, text: "not json" })
        .mockResolvedValueOnce({ ok: true, text: VALID_TIER_JSON });
      const r = await runTierGenerationSeam(CANDIDATE_ID, "accessible", {
        haikuClient,
      });
      expect(haikuClient).toHaveBeenCalledTimes(2);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.attempts).toBe(2);
      }
    });

    it("retry uses stricter prefill on second call", async () => {
      mock.queueSelect([makeRow()]);
      const haikuClient = jest
        .fn()
        .mockResolvedValueOnce({ ok: true, text: "not json" })
        .mockResolvedValueOnce({ ok: true, text: VALID_TIER_JSON });
      await runTierGenerationSeam(CANDIDATE_ID, "technical", { haikuClient });
      const firstCall = haikuClient.mock.calls[0]!;
      const secondCall = haikuClient.mock.calls[1]!;
      expect((firstCall[2] as any).prefill).toBe("{");
      expect((secondCall[2] as any).prefill).toBe('{"thesis":');
    });

    it("Zod-invalid first attempt (missing support) triggers retry", async () => {
      mock.queueSelect([makeRow()]);
      const onlyThesis = JSON.stringify({ thesis: "a thesis ok long enough" });
      const haikuClient = jest
        .fn()
        .mockResolvedValueOnce({ ok: true, text: onlyThesis })
        .mockResolvedValueOnce({ ok: true, text: VALID_TIER_JSON });
      const r = await runTierGenerationSeam(CANDIDATE_ID, "briefed", {
        haikuClient,
      });
      expect(haikuClient).toHaveBeenCalledTimes(2);
      expect(r.ok).toBe(true);
    });

    it("Zod-invalid first attempt (extra top-level field) triggers retry", async () => {
      mock.queueSelect([makeRow()]);
      const extraField = JSON.stringify({
        thesis: "valid thesis content here",
        support: "valid support content with enough characters to clear the floor",
        confidence: 0.9,
      });
      const haikuClient = jest
        .fn()
        .mockResolvedValueOnce({ ok: true, text: extraField })
        .mockResolvedValueOnce({ ok: true, text: VALID_TIER_JSON });
      const r = await runTierGenerationSeam(CANDIDATE_ID, "accessible", {
        haikuClient,
      });
      expect(haikuClient).toHaveBeenCalledTimes(2);
      expect(r.ok).toBe(true);
    });
  });

  describe("retry path — terminal TIER_PARSE_ERROR", () => {
    it("malformed JSON twice → TIER_PARSE_ERROR with attempts=2", async () => {
      mock.queueSelect([makeRow()]);
      const haikuClient = jest
        .fn()
        .mockResolvedValueOnce({ ok: true, text: '{"broken":' })
        .mockResolvedValueOnce({ ok: true, text: "still not json" });
      const r = await runTierGenerationSeam(CANDIDATE_ID, "accessible", {
        haikuClient,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.rejectionReason).toBe(TIER_REASONS.TIER_PARSE_ERROR);
        expect(r.attempts).toBe(2);
        expect(r.raw?.responseText).toBe("still not json");
      }
      expect(haikuClient).toHaveBeenCalledTimes(2);
    });

    it("first parse fails, second client-fails → TIER_PARSE_ERROR (parse error wins)", async () => {
      mock.queueSelect([makeRow()]);
      const haikuClient = jest
        .fn()
        .mockResolvedValueOnce({ ok: true, text: "garbled" })
        .mockResolvedValueOnce({ ok: false, reason: "timeout" });
      const r = await runTierGenerationSeam(CANDIDATE_ID, "accessible", {
        haikuClient,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.rejectionReason).toBe(TIER_REASONS.TIER_PARSE_ERROR);
        expect(r.attempts).toBe(2);
        expect(r.raw?.responseText).toBe("garbled");
      }
    });
  });

  describe("precondition failures", () => {
    it("missing candidate row → TIER_PARSE_ERROR without calling Haiku", async () => {
      mock.queueSelect([]);
      const haikuClient = ok(VALID_TIER_JSON);
      const r = await runTierGenerationSeam(CANDIDATE_ID, "accessible", {
        haikuClient,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.rejectionReason).toBe(TIER_REASONS.TIER_PARSE_ERROR);
        expect(r.attempts).toBe(0);
      }
      expect(haikuClient).not.toHaveBeenCalled();
    });

    it("missing facts → TIER_PARSE_ERROR without calling Haiku", async () => {
      mock.queueSelect([makeRow({ facts: null })]);
      const haikuClient = ok(VALID_TIER_JSON);
      const r = await runTierGenerationSeam(CANDIDATE_ID, "accessible", {
        haikuClient,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.rejectionReason).toBe(TIER_REASONS.TIER_PARSE_ERROR);
      }
      expect(haikuClient).not.toHaveBeenCalled();
    });

    it("missing body_text → TIER_PARSE_ERROR without calling Haiku", async () => {
      mock.queueSelect([makeRow({ bodyText: null })]);
      const haikuClient = ok(VALID_TIER_JSON);
      const r = await runTierGenerationSeam(CANDIDATE_ID, "accessible", {
        haikuClient,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.rejectionReason).toBe(TIER_REASONS.TIER_PARSE_ERROR);
      }
      expect(haikuClient).not.toHaveBeenCalled();
    });

    it("wrong status → TIER_PARSE_ERROR without calling Haiku", async () => {
      mock.queueSelect([makeRow({ status: "llm_relevant" })]);
      const haikuClient = ok(VALID_TIER_JSON);
      const r = await runTierGenerationSeam(CANDIDATE_ID, "accessible", {
        haikuClient,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.rejectionReason).toBe(TIER_REASONS.TIER_PARSE_ERROR);
      }
      expect(haikuClient).not.toHaveBeenCalled();
    });

    it("invalid sector → TIER_PARSE_ERROR without calling Haiku", async () => {
      mock.queueSelect([makeRow({ sector: "biotech" })]);
      const haikuClient = ok(VALID_TIER_JSON);
      const r = await runTierGenerationSeam(CANDIDATE_ID, "accessible", {
        haikuClient,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.rejectionReason).toBe(TIER_REASONS.TIER_PARSE_ERROR);
      }
      expect(haikuClient).not.toHaveBeenCalled();
    });

    it("status='tier_generated' is an accepted precondition (recovery path)", async () => {
      mock.queueSelect([makeRow({ status: "tier_generated" })]);
      const haikuClient = ok(VALID_TIER_JSON);
      const r = await runTierGenerationSeam(CANDIDATE_ID, "technical", {
        haikuClient,
      });
      expect(r.ok).toBe(true);
      expect(haikuClient).toHaveBeenCalledTimes(1);
    });
  });

  describe("logging", () => {
    it("logs success with tier + latency + attempts", async () => {
      mock.queueSelect([makeRow()]);
      const haikuClient = ok(VALID_TIER_JSON);
      const logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
      try {
        await runTierGenerationSeam(CANDIDATE_ID, "accessible", { haikuClient });
        const entry = logSpy.mock.calls.find((c) =>
          String(c[0]).includes("[ingestion-tier]"),
        );
        expect(entry).toBeDefined();
        expect(String(entry![0])).toContain("ok=true");
        expect(String(entry![0])).toContain("tier=accessible");
      } finally {
        logSpy.mockRestore();
      }
    });

    it("logs warning on rejection with tier + reason", async () => {
      mock.queueSelect([makeRow()]);
      const haikuClient = fail("timeout");
      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
      try {
        await runTierGenerationSeam(CANDIDATE_ID, "briefed", { haikuClient });
        const entry = warnSpy.mock.calls.find((c) =>
          String(c[0]).includes("[ingestion-tier]"),
        );
        expect(entry).toBeDefined();
        expect(String(entry![0])).toContain("rejected");
        expect(String(entry![0])).toContain("tier=briefed");
        expect(String(entry![0])).toContain("tier_timeout");
      } finally {
        warnSpy.mockRestore();
      }
    });
  });
});
