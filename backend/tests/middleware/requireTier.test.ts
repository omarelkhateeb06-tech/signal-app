import type { NextFunction, Request, Response } from "express";
import { createMockDb } from "../helpers/mockDb";

const mock = createMockDb();

jest.mock("../../src/db", () => ({
  __esModule: true,
  get db() {
    return mock.db;
  },
  schema: {},
  pool: {},
}));

import { attachTier, resolveEffectiveTier } from "../../src/middleware/requireTier";

const DAY_MS = 24 * 60 * 60 * 1000;

function makeRes(): Response {
  return {} as unknown as Response;
}

function makeReq(userId?: string): Request {
  return { user: userId ? { userId, email: "x@y.z" } : undefined } as unknown as Request;
}

describe("resolveEffectiveTier", () => {
  beforeEach(() => {
    mock.reset();
  });

  it("returns free for an undefined userId (unauthenticated)", async () => {
    const result = await resolveEffectiveTier(undefined);
    expect(result).toEqual({
      tier: "free",
      trialDaysRemaining: null,
      trialStartedAt: null,
    });
  });

  it("returns free when the user row is missing", async () => {
    mock.queueSelect([]);
    const result = await resolveEffectiveTier("ghost-user");
    expect(result.tier).toBe("free");
    expect(result.trialDaysRemaining).toBeNull();
    expect(result.trialStartedAt).toBeNull();
  });

  it("returns pro unchanged for a pro user", async () => {
    mock.queueSelect([{ tier: "pro", trialStartedAt: null }]);
    const result = await resolveEffectiveTier("pro-user");
    expect(result.tier).toBe("pro");
    expect(result.trialDaysRemaining).toBeNull();
    expect(mock.state.updatedRows).toHaveLength(0);
  });

  it("returns free unchanged for a free user", async () => {
    const anchor = new Date(Date.now() - 30 * DAY_MS);
    mock.queueSelect([{ tier: "free", trialStartedAt: anchor }]);
    const result = await resolveEffectiveTier("free-user");
    expect(result.tier).toBe("free");
    expect(result.trialDaysRemaining).toBeNull();
    expect(result.trialStartedAt).toEqual(anchor);
    expect(mock.state.updatedRows).toHaveLength(0);
  });

  it("returns pro_trial with days remaining when trial is active", async () => {
    const anchor = new Date(Date.now() - 2 * DAY_MS); // 2 days in, 5 left
    mock.queueSelect([{ tier: "pro_trial", trialStartedAt: anchor }]);
    const result = await resolveEffectiveTier("trial-user");
    expect(result.tier).toBe("pro_trial");
    expect(result.trialDaysRemaining).toBe(5);
    expect(result.trialStartedAt).toEqual(anchor);
    expect(mock.state.updatedRows).toHaveLength(0);
  });

  it("returns pro_trial with 7 days remaining on a fresh trial", async () => {
    const anchor = new Date(Date.now() - 1000); // 1 second in
    mock.queueSelect([{ tier: "pro_trial", trialStartedAt: anchor }]);
    const result = await resolveEffectiveTier("fresh-trial");
    expect(result.tier).toBe("pro_trial");
    expect(result.trialDaysRemaining).toBe(7);
  });

  it("returns pro_trial with 1 day remaining inside the final 24h (urgent zone)", async () => {
    const anchor = new Date(Date.now() - (7 * DAY_MS - 12 * 60 * 60 * 1000));
    mock.queueSelect([{ tier: "pro_trial", trialStartedAt: anchor }]);
    const result = await resolveEffectiveTier("almost-expired");
    expect(result.tier).toBe("pro_trial");
    expect(result.trialDaysRemaining).toBe(1);
  });

  it("lazy-downgrades to free and writes tierChangedAt when trial has expired", async () => {
    const anchor = new Date(Date.now() - 8 * DAY_MS); // 1 day past expiry
    mock.queueSelect([{ tier: "pro_trial", trialStartedAt: anchor }]);
    const result = await resolveEffectiveTier("expired-trial");
    expect(result.tier).toBe("free");
    expect(result.trialDaysRemaining).toBe(0);
    expect(result.trialStartedAt).toEqual(anchor); // preserved for audit
    expect(mock.state.updatedRows).toHaveLength(1);
    const patch = mock.state.updatedRows[0];
    expect(patch.tier).toBe("free");
    expect(patch.tierChangedAt).toBeInstanceOf(Date);
  });

  it("anchors trial_started_at when a pro_trial row has no anchor (anomaly path)", async () => {
    mock.queueSelect([{ tier: "pro_trial", trialStartedAt: null }]);
    const result = await resolveEffectiveTier("orphan-trial");
    expect(result.tier).toBe("pro_trial");
    expect(result.trialDaysRemaining).toBe(7);
    expect(result.trialStartedAt).toBeInstanceOf(Date);
    expect(mock.state.updatedRows).toHaveLength(1);
    const patch = mock.state.updatedRows[0];
    expect(patch.trialStartedAt).toBeInstanceOf(Date);
    expect(patch.tier).toBeUndefined(); // anchoring must not flip tier
  });
});

describe("attachTier middleware", () => {
  beforeEach(() => {
    mock.reset();
  });

  it("sets req.tier and calls next() on success", async () => {
    mock.queueSelect([{ tier: "pro", trialStartedAt: null }]);
    const req = makeReq("pro-user");
    const next = jest.fn() as unknown as NextFunction;
    await attachTier(req, makeRes(), next);
    expect(req.tier).toBe("pro");
    expect(next).toHaveBeenCalledWith();
    expect((next as jest.Mock).mock.calls[0]).toHaveLength(0);
  });

  it("defaults req.tier to free for unauthenticated requests", async () => {
    const req = makeReq(undefined);
    const next = jest.fn() as unknown as NextFunction;
    await attachTier(req, makeRes(), next);
    expect(req.tier).toBe("free");
    expect((next as jest.Mock).mock.calls[0]).toHaveLength(0);
  });
});
