import type { NextFunction, Request, Response } from "express";
import { createMockDb } from "./helpers/mockDb";

const mock = createMockDb();

jest.mock("../src/db", () => ({
  __esModule: true,
  get db() {
    return mock.db;
  },
  schema: {},
  pool: {},
}));

import { apiKeyAuth } from "../src/middleware/apiKeyAuth";
import { AppError } from "../src/middleware/errorHandler";
import { generateApiKey } from "../src/services/apiKeyService";

function makeReq(headers: Record<string, string> = {}): Request {
  const lowered: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lowered[k.toLowerCase()] = v;
  return {
    headers: lowered,
    header(name: string) {
      return lowered[name.toLowerCase()];
    },
  } as unknown as Request;
}

describe("apiKeyAuth middleware", () => {
  beforeEach(() => {
    mock.reset();
  });

  it("calls next with 401 when X-API-Key header is missing", async () => {
    const req = makeReq();
    const next: NextFunction = jest.fn();
    await apiKeyAuth(req, {} as Response, next);
    const err = (next as jest.Mock).mock.calls[0][0] as AppError;
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(401);
    expect(err.code).toBe("UNAUTHORIZED");
  });

  it("calls next with 401 when the key does not match any row", async () => {
    mock.queueSelect([]); // DB returns no match

    const req = makeReq({ "X-API-Key": "sgnl_live_TEST_FIXTURE_unknown_key" });
    const next: NextFunction = jest.fn();
    await apiKeyAuth(req, {} as Response, next);
    const err = (next as jest.Mock).mock.calls[0][0] as AppError;
    expect(err.status).toBe(401);
  });

  it("attaches req.apiKey when the hash matches and calls next()", async () => {
    const { fullKey } = generateApiKey();
    mock.queueSelect([
      { id: "key-1", userId: "user-1", label: "ci", revokedAt: null },
    ]);

    const req = makeReq({ "X-API-Key": fullKey });
    const next: NextFunction = jest.fn();
    await apiKeyAuth(req, {} as Response, next);
    expect(next).toHaveBeenCalledWith();
    expect(req.apiKey).toEqual({ id: "key-1", userId: "user-1", label: "ci" });
  });
});
