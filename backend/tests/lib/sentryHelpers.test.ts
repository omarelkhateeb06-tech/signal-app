/* eslint-disable @typescript-eslint/no-explicit-any */
// Mock @sentry/node BEFORE importing the helper so the helper's
// `import * as Sentry from "@sentry/node"` binds to the mocked module.

const setTagMock = jest.fn();
const captureExceptionMock = jest.fn();
const withScopeMock = jest.fn((cb: (scope: { setTag: jest.Mock }) => void) => {
  cb({ setTag: setTagMock });
});

jest.mock("@sentry/node", () => ({
  withScope: (cb: any) => withScopeMock(cb),
  captureException: (err: any) => captureExceptionMock(err),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const { captureIngestionStageFailure } = require("../../src/lib/sentryHelpers");

beforeEach(() => {
  setTagMock.mockClear();
  captureExceptionMock.mockClear();
  withScopeMock.mockClear();
});

describe("captureIngestionStageFailure", () => {
  it("sets the canonical tag set and captures via Sentry.captureException", () => {
    captureIngestionStageFailure({
      stage: "facts",
      candidateId: "cand-1",
      sourceSlug: "cnbc-markets",
      rejectionReason: "facts_parse_error",
    });

    expect(withScopeMock).toHaveBeenCalledTimes(1);
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);

    // All four tags set in the same scope.
    const tagCalls = setTagMock.mock.calls;
    expect(tagCalls).toEqual(
      expect.arrayContaining([
        ["ingestion.stage", "facts"],
        ["ingestion.candidate_id", "cand-1"],
        ["ingestion.source_slug", "cnbc-markets"],
        ["ingestion.rejection_reason", "facts_parse_error"],
      ]),
    );
    // No extra tags beyond the four canonical ones.
    expect(tagCalls.length).toBe(4);
  });

  it("synthesizes an Error from the rejection reason when err is undefined", () => {
    captureIngestionStageFailure({
      stage: "relevance",
      candidateId: "cand-2",
      sourceSlug: "import-ai",
      rejectionReason: "llm_timeout",
    });
    const captured = captureExceptionMock.mock.calls[0][0];
    expect(captured).toBeInstanceOf(Error);
    expect(captured.message).toContain("ingestion.relevance failed: llm_timeout");
  });

  it("propagates an explicit Error object verbatim (preserves stack)", () => {
    const original = new Error("PG connection refused");
    captureIngestionStageFailure({
      stage: "write_event",
      candidateId: "cand-3",
      sourceSlug: "bloomberg-markets",
      rejectionReason: "write_event_error: PG connection refused",
      err: original,
    });
    const captured = captureExceptionMock.mock.calls[0][0];
    expect(captured).toBe(original);
  });

  it("wraps a non-Error err value in a synthetic Error with both reason and detail", () => {
    captureIngestionStageFailure({
      stage: "tiers",
      candidateId: "cand-4",
      sourceSlug: "arstechnica-ai",
      rejectionReason: "tier_orchestration_indeterminate",
      err: "raw-string-thrown-by-something",
    });
    const captured = captureExceptionMock.mock.calls[0][0];
    expect(captured).toBeInstanceOf(Error);
    expect(captured.message).toContain("tier_orchestration_indeterminate");
    expect(captured.message).toContain("raw-string-thrown-by-something");
  });

  it("omits the source_slug tag when sourceSlug is null", () => {
    captureIngestionStageFailure({
      stage: "tiers",
      candidateId: "cand-5",
      sourceSlug: null,
      rejectionReason: "TIER_TIMEOUT",
    });
    const tagKeys = setTagMock.mock.calls.map((c) => c[0]);
    expect(tagKeys).toContain("ingestion.stage");
    expect(tagKeys).toContain("ingestion.candidate_id");
    expect(tagKeys).toContain("ingestion.rejection_reason");
    expect(tagKeys).not.toContain("ingestion.source_slug");
    expect(tagKeys.length).toBe(3);
  });

  it("each call gets its own scope (concurrency isolation)", () => {
    captureIngestionStageFailure({
      stage: "facts",
      candidateId: "a",
      sourceSlug: "src-a",
      rejectionReason: "facts_timeout",
    });
    captureIngestionStageFailure({
      stage: "tiers",
      candidateId: "b",
      sourceSlug: "src-b",
      rejectionReason: "TIER_PARSE_ERROR",
    });
    // Two separate withScope invocations — no shared scope between
    // concurrent worker calls. captureException fires once per call.
    expect(withScopeMock).toHaveBeenCalledTimes(2);
    expect(captureExceptionMock).toHaveBeenCalledTimes(2);
  });

  it("appends extraTags after the canonical tag set (sub-step 7)", () => {
    captureIngestionStageFailure({
      stage: "worker_failed",
      candidateId: "cand-7",
      sourceSlug: "cnbc-markets",
      rejectionReason: "Connection refused",
      extraTags: {
        "bullmq.attempt": "2",
        "bullmq.queue": "signal-ingestion-enrich",
      },
    });
    const tagCalls = setTagMock.mock.calls;
    // 4 canonical tags + 2 extra = 6 setTag calls.
    expect(tagCalls.length).toBe(6);
    expect(tagCalls).toEqual(
      expect.arrayContaining([
        ["ingestion.stage", "worker_failed"],
        ["ingestion.candidate_id", "cand-7"],
        ["ingestion.source_slug", "cnbc-markets"],
        ["ingestion.rejection_reason", "Connection refused"],
        ["bullmq.attempt", "2"],
        ["bullmq.queue", "signal-ingestion-enrich"],
      ]),
    );
  });

  it("works with empty extraTags object (no extra setTag calls)", () => {
    captureIngestionStageFailure({
      stage: "facts",
      candidateId: "cand-8",
      sourceSlug: "src",
      rejectionReason: "facts_timeout",
      extraTags: {},
    });
    expect(setTagMock.mock.calls.length).toBe(4);
  });
});
