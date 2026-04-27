/* eslint-disable @typescript-eslint/no-explicit-any */
import type { NextFunction, Request, Response } from "express";

const redisIncrMock = jest.fn();
const redisExpireMock = jest.fn();
let redisInstance: { incr: jest.Mock; expire: jest.Mock } | null = {
  incr: redisIncrMock,
  expire: redisExpireMock,
};

jest.mock("../src/lib/redis", () => ({
  __esModule: true,
  getRedis: () => redisInstance,
  isRedisConfigured: () => redisInstance !== null,
  getRedisUrl: () => (redisInstance ? "redis://stub" : null),
  closeRedis: async () => undefined,
}));

const captureMessageMock = jest.fn();
jest.mock("@sentry/node", () => ({
  __esModule: true,
  captureMessage: (...args: unknown[]) => captureMessageMock(...args),
}));

import { apiKeyRateLimit } from "../src/middleware/apiKeyRateLimit";

function makeReq(apiKeyId: string): Request {
  return {
    apiKey: { id: apiKeyId, userId: "user-1", label: "ci" },
  } as unknown as Request;
}

function makeReqWithoutApiKey(): Request {
  return {} as unknown as Request;
}

interface MockRes {
  res: Response;
  status: jest.Mock;
  json: jest.Mock;
  setHeader: jest.Mock;
  headers: Record<string, string>;
}

function makeRes(): MockRes {
  const headers: Record<string, string> = {};
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const setHeader = jest.fn((name: string, value: string) => {
    headers[name] = value;
  });
  const res = { status, json, setHeader } as unknown as Response;
  return { res, status, json, setHeader, headers };
}

function resetMocks(): void {
  redisIncrMock.mockReset();
  redisExpireMock.mockReset();
  captureMessageMock.mockReset();
  redisInstance = { incr: redisIncrMock, expire: redisExpireMock };
}

describe("apiKeyRateLimit middleware", () => {
  let consoleWarn: jest.SpyInstance;
  let prevLimitEnv: string | undefined;

  beforeEach(() => {
    resetMocks();
    consoleWarn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    prevLimitEnv = process.env.API_KEY_RATE_LIMIT_PER_MINUTE;
  });

  afterEach(() => {
    consoleWarn.mockRestore();
    if (prevLimitEnv === undefined) {
      delete process.env.API_KEY_RATE_LIMIT_PER_MINUTE;
    } else {
      process.env.API_KEY_RATE_LIMIT_PER_MINUTE = prevLimitEnv;
    }
  });

  it("passes through under the limit, decrementing X-RateLimit-Remaining", async () => {
    redisIncrMock.mockResolvedValueOnce(1);
    redisExpireMock.mockResolvedValueOnce(1);
    const { res, setHeader, headers } = makeRes();
    const next = jest.fn() as NextFunction;

    await apiKeyRateLimit(makeReq("key-a"), res, next);

    expect(next).toHaveBeenCalledWith();
    expect(headers["X-RateLimit-Limit"]).toBe("300");
    expect(headers["X-RateLimit-Remaining"]).toBe("299");
    expect(headers["X-RateLimit-Reset"]).toMatch(/^\d+$/);
    expect(setHeader).not.toHaveBeenCalledWith("Retry-After", expect.anything());
  });

  it("only calls EXPIRE on the first hit of a window (INCR=1), not subsequent hits", async () => {
    redisIncrMock.mockResolvedValueOnce(2);
    const { res } = makeRes();
    const next = jest.fn() as NextFunction;

    await apiKeyRateLimit(makeReq("key-a"), res, next);

    expect(next).toHaveBeenCalledWith();
    expect(redisExpireMock).not.toHaveBeenCalled();
  });

  it("sets EXPIRE to WINDOW_SECONDS (60) on the first hit", async () => {
    redisIncrMock.mockResolvedValueOnce(1);
    redisExpireMock.mockResolvedValueOnce(1);
    const { res } = makeRes();

    await apiKeyRateLimit(makeReq("key-a"), res, jest.fn());

    expect(redisExpireMock).toHaveBeenCalledWith(expect.any(String), 60);
  });

  it("allows the request at exactly the limit with remaining=0", async () => {
    process.env.API_KEY_RATE_LIMIT_PER_MINUTE = "5";
    redisIncrMock.mockResolvedValueOnce(5);
    const { res, headers, status } = makeRes();
    const next = jest.fn() as NextFunction;

    await apiKeyRateLimit(makeReq("key-a"), res, next);

    expect(next).toHaveBeenCalledWith();
    expect(status).not.toHaveBeenCalled();
    expect(headers["X-RateLimit-Limit"]).toBe("5");
    expect(headers["X-RateLimit-Remaining"]).toBe("0");
  });

  it("returns 429 RATE_LIMIT_EXCEEDED when the counter exceeds the limit", async () => {
    process.env.API_KEY_RATE_LIMIT_PER_MINUTE = "5";
    redisIncrMock.mockResolvedValueOnce(6);
    const { res, status, json, headers } = makeRes();
    const next = jest.fn() as NextFunction;

    await apiKeyRateLimit(makeReq("key-a"), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(429);
    expect(json).toHaveBeenCalledWith({
      error: {
        code: "RATE_LIMIT_EXCEEDED",
        message: expect.stringMatching(/Rate limit of 5 requests per minute/),
      },
    });
    expect(headers["Retry-After"]).toMatch(/^\d+$/);
    expect(Number(headers["Retry-After"])).toBeGreaterThanOrEqual(1);
    expect(Number(headers["Retry-After"])).toBeLessThanOrEqual(60);
    expect(headers["X-RateLimit-Limit"]).toBe("5");
    expect(headers["X-RateLimit-Remaining"]).toBe("0");
    expect(headers["X-RateLimit-Reset"]).toMatch(/^\d+$/);
  });

  it("scopes counters by key — different apiKeyIds hit different Redis keys", async () => {
    redisIncrMock.mockResolvedValue(1);
    redisExpireMock.mockResolvedValue(1);

    await apiKeyRateLimit(makeReq("key-a"), makeRes().res, jest.fn());
    await apiKeyRateLimit(makeReq("key-b"), makeRes().res, jest.fn());

    const keyA = redisIncrMock.mock.calls[0]?.[0] as string;
    const keyB = redisIncrMock.mock.calls[1]?.[0] as string;
    expect(keyA).toMatch(/^ratelimit:apikey:key-a:\d+$/);
    expect(keyB).toMatch(/^ratelimit:apikey:key-b:\d+$/);
    expect(keyA).not.toBe(keyB);
  });

  it("fails open with warn + Sentry('warning') when INCR throws", async () => {
    redisIncrMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const { res, headers, status } = makeRes();
    const next = jest.fn() as NextFunction;

    await apiKeyRateLimit(makeReq("key-a"), res, next);

    expect(next).toHaveBeenCalledWith();
    expect(status).not.toHaveBeenCalled();
    expect(consoleWarn).toHaveBeenCalledWith(
      expect.stringContaining("ratelimit_redis_unavailable"),
    );
    expect(captureMessageMock).toHaveBeenCalledWith(
      "Rate limiter fail-open: Redis unavailable",
      expect.objectContaining({ level: "warning" }),
    );
    expect(headers["X-RateLimit-Limit"]).toBe("300");
    expect(headers["X-RateLimit-Remaining"]).toBe("300");
  });

  it("fails open with Sentry('warning') when EXPIRE throws on first-hit path", async () => {
    redisIncrMock.mockResolvedValueOnce(1);
    redisExpireMock.mockRejectedValueOnce(new Error("redis blip"));
    const { res } = makeRes();
    const next = jest.fn() as NextFunction;

    await apiKeyRateLimit(makeReq("key-a"), res, next);

    expect(next).toHaveBeenCalledWith();
    expect(captureMessageMock).toHaveBeenCalledWith(
      "Rate limiter fail-open: Redis unavailable",
      expect.objectContaining({ level: "warning" }),
    );
  });

  it("passes through without Sentry noise when Redis is not configured (getRedis returns null)", async () => {
    redisInstance = null;
    const { res, headers } = makeRes();
    const next = jest.fn() as NextFunction;

    await apiKeyRateLimit(makeReq("key-a"), res, next);

    expect(next).toHaveBeenCalledWith();
    expect(captureMessageMock).not.toHaveBeenCalled();
    expect(headers["X-RateLimit-Limit"]).toBe("300");
    expect(headers["X-RateLimit-Remaining"]).toBe("300");
  });

  it("passes through with a warning when req.apiKey is missing (defensive, no 500)", async () => {
    const { res, status } = makeRes();
    const next = jest.fn() as NextFunction;

    await apiKeyRateLimit(makeReqWithoutApiKey(), res, next);

    expect(next).toHaveBeenCalledWith();
    expect(status).not.toHaveBeenCalled();
    expect(redisIncrMock).not.toHaveBeenCalled();
    expect(consoleWarn).toHaveBeenCalledWith(
      expect.stringContaining("req.apiKey missing"),
    );
  });

  it("honors API_KEY_RATE_LIMIT_PER_MINUTE env override", async () => {
    process.env.API_KEY_RATE_LIMIT_PER_MINUTE = "42";
    redisIncrMock.mockResolvedValueOnce(1);
    redisExpireMock.mockResolvedValueOnce(1);
    const { res, headers } = makeRes();

    await apiKeyRateLimit(makeReq("key-a"), res, jest.fn());

    expect(headers["X-RateLimit-Limit"]).toBe("42");
    expect(headers["X-RateLimit-Remaining"]).toBe("41");
  });

  it("ignores non-numeric env overrides and falls back to the default", async () => {
    process.env.API_KEY_RATE_LIMIT_PER_MINUTE = "not-a-number";
    redisIncrMock.mockResolvedValueOnce(1);
    redisExpireMock.mockResolvedValueOnce(1);
    const { res, headers } = makeRes();

    await apiKeyRateLimit(makeReq("key-a"), res, jest.fn());

    expect(headers["X-RateLimit-Limit"]).toBe("300");
  });

  it("emits X-RateLimit-* headers as plain numeric strings (not NaN/undefined)", async () => {
    redisIncrMock.mockResolvedValueOnce(1);
    redisExpireMock.mockResolvedValueOnce(1);
    const { res, headers } = makeRes();

    await apiKeyRateLimit(makeReq("key-a"), res, jest.fn());

    for (const header of ["X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset"]) {
      const value = headers[header];
      expect(value).toBeDefined();
      expect(value).toMatch(/^\d+$/);
      expect(Number.isFinite(Number(value))).toBe(true);
    }
  });
});
