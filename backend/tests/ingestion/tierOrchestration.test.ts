/* eslint-disable @typescript-eslint/no-explicit-any */
// Phase 12e.5b — partial-state recovery test for the tier-generation
// orchestration loop. We mock the seam directly via the deps shim and
// the DB via createMockDb.

import { createMockDb, type MockDb } from "../helpers/mockDb";
import type { TierName } from "../../src/services/haikuTierClient";
import type { TierSeamResult } from "../../src/jobs/ingestion/tierGenerationSeam";

let mock: MockDb;
jest.mock("../../src/db", () => ({
  get db() {
    return mock.db;
  },
  pool: { end: () => Promise.resolve() },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const { processTierGeneration } = require("../../src/jobs/ingestion/tierOrchestration");

const CANDIDATE_ID = "00000000-0000-0000-0000-000000000ab1";

beforeEach(() => {
  mock = createMockDb();
});

function successResult(tier: TierName): TierSeamResult {
  return {
    ok: true,
    tier,
    output: {
      thesis: `thesis for ${tier}, long enough to pass min length`,
      support: `support for ${tier}, long enough to clear min`,
    },
    attempts: 1,
    latencyMs: 100,
    rawResponse: "{}",
    raw: {
      model: "claude-haiku-4-5-20251001",
      promptText: "p",
      responseText: "{}",
      latencyMs: 100,
      attempts: 1,
    },
  };
}

function failureResult(tier: TierName): TierSeamResult {
  return {
    ok: false,
    tier,
    rejectionReason: "tier_timeout",
    attempts: 1,
  };
}

describe("processTierGeneration — partial-state recovery", () => {
  it("candidate with all three tiers missing runs all three in order", async () => {
    // Initial state load: tier_outputs is null → no tiers exist.
    mock.queueSelect([{ status: "facts_extracted", tierOutputs: null }]);

    const seenTiers: TierName[] = [];
    const runTier = jest.fn(async (_id: string, tier: TierName) => {
      seenTiers.push(tier);
      return successResult(tier);
    });

    const summary = await processTierGeneration(CANDIDATE_ID, { runTier });

    expect(seenTiers).toEqual(["accessible", "briefed", "technical"]);
    expect(summary.ranTiers).toEqual(["accessible", "briefed", "technical"]);
    expect(summary.skippedTiers).toEqual([]);
    expect(summary.failedTier).toBeNull();
    expect(summary.completed).toBe(true);
  });

  it("candidate with accessible already done runs only briefed and technical", async () => {
    // Initial state: only accessible exists.
    mock.queueSelect([
      {
        status: "facts_extracted",
        tierOutputs: {
          accessible: { thesis: "x", support: "y" },
        },
      },
    ]);

    const seenTiers: TierName[] = [];
    const runTier = jest.fn(async (_id: string, tier: TierName) => {
      seenTiers.push(tier);
      return successResult(tier);
    });

    const summary = await processTierGeneration(CANDIDATE_ID, { runTier });

    expect(seenTiers).toEqual(["briefed", "technical"]);
    expect(summary.ranTiers).toEqual(["briefed", "technical"]);
    expect(summary.skippedTiers).toEqual(["accessible"]);
    expect(summary.failedTier).toBeNull();
    expect(summary.completed).toBe(true);
  });

  it("candidate with accessible+briefed done runs only technical", async () => {
    mock.queueSelect([
      {
        status: "facts_extracted",
        tierOutputs: {
          accessible: { thesis: "x", support: "y" },
          briefed: { thesis: "x", support: "y" },
        },
      },
    ]);

    const runTier = jest.fn(async (_id: string, tier: TierName) =>
      successResult(tier),
    );

    const summary = await processTierGeneration(CANDIDATE_ID, { runTier });

    expect(runTier).toHaveBeenCalledTimes(1);
    expect(runTier.mock.calls[0]![1]).toBe("technical");
    expect(summary.skippedTiers).toEqual(["accessible", "briefed"]);
    expect(summary.ranTiers).toEqual(["technical"]);
    expect(summary.completed).toBe(true);
  });

  it("technical tier failure leaves status at facts_extracted with status_reason", async () => {
    // accessible+briefed already present; technical will fail.
    mock.queueSelect([
      {
        status: "facts_extracted",
        tierOutputs: {
          accessible: { thesis: "x", support: "y" },
          briefed: { thesis: "x", support: "y" },
        },
      },
    ]);

    const runTier = jest.fn(async (_id: string, tier: TierName) =>
      tier === "technical" ? failureResult(tier) : successResult(tier),
    );

    const summary = await processTierGeneration(CANDIDATE_ID, { runTier });

    expect(summary.failedTier).toEqual({
      tier: "technical",
      reason: "tier_timeout",
    });
    expect(summary.completed).toBe(false);
    // Last update tracked should mark status=facts_extracted with reason.
    const lastUpdate = mock.state.updatedRows.at(-1);
    expect(lastUpdate).toMatchObject({
      status: "facts_extracted",
      statusReason: "tier_timeout",
    });
  });

  it("on full success, advances status to tier_generated with timestamp", async () => {
    mock.queueSelect([{ status: "facts_extracted", tierOutputs: null }]);
    const runTier = jest.fn(async (_id: string, tier: TierName) =>
      successResult(tier),
    );

    const summary = await processTierGeneration(CANDIDATE_ID, { runTier });

    expect(summary.completed).toBe(true);
    const finalUpdate = mock.state.updatedRows.at(-1);
    expect(finalUpdate.status).toBe("tier_generated");
    expect(finalUpdate.tierGeneratedAt).toBeInstanceOf(Date);
    // Three jsonb_set executes (one per tier).
    expect(mock.state.executes.length).toBe(3);
  });

  it("missing candidate (load returns null) is a no-op", async () => {
    mock.queueSelect([]);
    const runTier = jest.fn();
    const summary = await processTierGeneration(CANDIDATE_ID, { runTier });
    expect(runTier).not.toHaveBeenCalled();
    expect(summary.ranTiers).toEqual([]);
    expect(summary.completed).toBe(false);
  });
});
