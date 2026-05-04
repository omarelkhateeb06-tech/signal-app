/* eslint-disable @typescript-eslint/no-explicit-any */
import { createMockDb, type MockDb } from "../helpers/mockDb";
import { HEURISTIC_REASONS, type HeuristicReason } from "../../src/jobs/ingestion/heuristics";
import type { BodyExtractionResult } from "../../src/jobs/ingestion/bodyExtractor";

let mock: MockDb;
jest.mock("../../src/db", () => ({
  get db() {
    return mock.db;
  },
}));

// Import after mock so module bindings resolve to mocked db.
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const { runHeuristicSeam } = require("../../src/jobs/ingestion/heuristicSeam");

const CANDIDATE_ID = "00000000-0000-0000-0000-0000000000bb";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CANDIDATE_ID,
    url: "https://example.com/article",
    rawTitle: "TSMC reports Q1 results above estimates",
    rawSummary: "TSMC's Q1 earnings beat consensus.",
    rawPublishedAt: new Date(Date.now() - 1 * 60 * 60 * 1000), // 1h ago
    sourceConfig: {},
    ...overrides,
  };
}

function fetchOk(text: string, truncated = false): jest.Mock {
  return jest.fn().mockResolvedValue({
    success: true,
    text,
    truncated,
  } satisfies BodyExtractionResult);
}

function fetchFail(reason: HeuristicReason): jest.Mock {
  return jest.fn().mockResolvedValue({
    success: false,
    reason,
  } satisfies BodyExtractionResult);
}

beforeEach(() => {
  mock = createMockDb();
});

describe("runHeuristicSeam", () => {
  describe("missing candidate", () => {
    it("returns body_fetch_failed when row not found", async () => {
      mock.queueSelect([]);
      const result = await runHeuristicSeam(CANDIDATE_ID, {
        fetchBody: fetchOk("ignored"),
      });
      expect(result.pass).toBe(false);
      expect(result.reason).toBe(HEURISTIC_REASONS.BODY_FETCH_FAILED);
    });
  });

  describe("pre-fetch reject branches (do NOT call fetchBody)", () => {
    it("rejects summary_and_title_empty", async () => {
      mock.queueSelect([makeRow({ rawTitle: null, rawSummary: null })]);
      const fetchBody = fetchOk("never called");
      const result = await runHeuristicSeam(CANDIDATE_ID, { fetchBody });
      expect(result.pass).toBe(false);
      expect(result.reason).toBe(HEURISTIC_REASONS.SUMMARY_AND_TITLE_EMPTY);
      expect(fetchBody).not.toHaveBeenCalled();
    });

    it("rejects recency_too_old", async () => {
      mock.queueSelect([
        makeRow({ rawPublishedAt: new Date(Date.now() - 50 * 60 * 60 * 1000) }),
      ]);
      const fetchBody = fetchOk("never called");
      const result = await runHeuristicSeam(CANDIDATE_ID, { fetchBody });
      expect(result.pass).toBe(false);
      expect(result.reason).toBe(HEURISTIC_REASONS.RECENCY_TOO_OLD);
      expect(fetchBody).not.toHaveBeenCalled();
    });

    it("rejects recency_too_old when publishedAt is null", async () => {
      mock.queueSelect([makeRow({ rawPublishedAt: null })]);
      const fetchBody = fetchOk("never called");
      const result = await runHeuristicSeam(CANDIDATE_ID, { fetchBody });
      expect(result.pass).toBe(false);
      expect(result.reason).toBe(HEURISTIC_REASONS.RECENCY_TOO_OLD);
      expect(fetchBody).not.toHaveBeenCalled();
    });

    it("rejects noise_linkbait", async () => {
      mock.queueSelect([
        makeRow({ rawTitle: "Shocking new revelation about AI" }),
      ]);
      const fetchBody = fetchOk("never called");
      const result = await runHeuristicSeam(CANDIDATE_ID, { fetchBody });
      expect(result.pass).toBe(false);
      expect(result.reason).toBe(HEURISTIC_REASONS.NOISE_LINKBAIT);
      expect(fetchBody).not.toHaveBeenCalled();
    });

    it("rejects noise_listicle", async () => {
      // Listicle pattern: ^(top|the )?\d+\s+(things|...|tips|...).
      // The "(top|the )?" alternation has no trailing space on `top`,
      // so "Top 10 tips" does NOT match — but "10 tips" does (the
      // optional prefix matches empty).
      mock.queueSelect([
        makeRow({ rawTitle: "10 tips for surviving the rate hike" }),
      ]);
      const fetchBody = fetchOk("never called");
      const result = await runHeuristicSeam(CANDIDATE_ID, { fetchBody });
      expect(result.pass).toBe(false);
      expect(result.reason).toBe(HEURISTIC_REASONS.NOISE_LISTICLE);
      expect(fetchBody).not.toHaveBeenCalled();
    });

    it("rejects noise_paid", async () => {
      mock.queueSelect([
        makeRow({ rawTitle: "Sponsored content: a look at semiconductor manufacturing" }),
      ]);
      const fetchBody = fetchOk("never called");
      const result = await runHeuristicSeam(CANDIDATE_ID, { fetchBody });
      expect(result.pass).toBe(false);
      expect(result.reason).toBe(HEURISTIC_REASONS.NOISE_PAID);
      expect(fetchBody).not.toHaveBeenCalled();
    });

    it("rejects filtered_video_url for Bloomberg /news/videos/ paths", async () => {
      mock.queueSelect([
        makeRow({
          url: "https://www.bloomberg.com/news/videos/2026-04-27/some-clip",
        }),
      ]);
      const fetchBody = fetchOk("never called");
      const result = await runHeuristicSeam(CANDIDATE_ID, { fetchBody });
      expect(result.pass).toBe(false);
      expect(result.reason).toBe(HEURISTIC_REASONS.FILTERED_VIDEO_URL);
      expect(fetchBody).not.toHaveBeenCalled();
    });
  });

  describe("body fetch failure branches", () => {
    it.each([
      [HEURISTIC_REASONS.BODY_TIMEOUT],
      [HEURISTIC_REASONS.BODY_4XX],
      [HEURISTIC_REASONS.BODY_5XX],
      [HEURISTIC_REASONS.BODY_WRONG_CONTENT_TYPE],
      [HEURISTIC_REASONS.BODY_PARSE_ERROR],
      [HEURISTIC_REASONS.BODY_NETWORK],
    ])("propagates fetch reason %s", async (reason) => {
      mock.queueSelect([makeRow()]);
      const fetchBody = fetchFail(reason);
      const result = await runHeuristicSeam(CANDIDATE_ID, { fetchBody });
      expect(result.pass).toBe(false);
      expect(result.reason).toBe(reason);
      expect(fetchBody).toHaveBeenCalledTimes(1);
    });
  });

  describe("post-fetch length floor", () => {
    it("rejects body_too_short when text under floor", async () => {
      mock.queueSelect([makeRow()]);
      const fetchBody = fetchOk("short body");
      const result = await runHeuristicSeam(CANDIDATE_ID, { fetchBody });
      expect(result.pass).toBe(false);
      expect(result.reason).toBe(HEURISTIC_REASONS.BODY_TOO_SHORT);
    });
  });

  describe("pass branch", () => {
    it("passes with body when all checks succeed", async () => {
      mock.queueSelect([makeRow()]);
      const longBody = "x".repeat(800);
      const fetchBody = fetchOk(longBody);
      const result = await runHeuristicSeam(CANDIDATE_ID, { fetchBody });
      expect(result.pass).toBe(true);
      expect(result.body?.text).toBe(longBody);
      expect(result.body?.truncated).toBe(false);
    });

    it("passes with truncated=true when fetchBody reports truncation", async () => {
      mock.queueSelect([makeRow()]);
      const longBody = "x".repeat(800);
      const fetchBody = fetchOk(longBody, true);
      const result = await runHeuristicSeam(CANDIDATE_ID, { fetchBody });
      expect(result.pass).toBe(true);
      expect(result.body?.truncated).toBe(true);
    });
  });

  describe("user-agent override from source.config", () => {
    it("forwards source.config.userAgent to fetchBody", async () => {
      mock.queueSelect([makeRow({ sourceConfig: { userAgent: "PerSource-UA/1.0" } })]);
      const fetchBody = fetchOk("x".repeat(800));
      await runHeuristicSeam(CANDIDATE_ID, { fetchBody });
      expect(fetchBody).toHaveBeenCalledWith(
        "https://example.com/article",
        { userAgent: "PerSource-UA/1.0" },
      );
    });

    it("uses default UA when source.config.userAgent is unset", async () => {
      mock.queueSelect([makeRow()]);
      const fetchBody = fetchOk("x".repeat(800));
      await runHeuristicSeam(CANDIDATE_ID, { fetchBody });
      const args = (fetchBody as jest.Mock).mock.calls[0]!;
      expect(args[1].userAgent).toBe("SIGNAL/12e.3 (+contact@signal.so)");
    });
  });
});
