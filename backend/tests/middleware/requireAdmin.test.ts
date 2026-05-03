import type { NextFunction, Request, Response } from "express";
import { requireAdmin } from "../../src/middleware/requireAdmin";
import { AppError } from "../../src/middleware/errorHandler";

function makeRes(): Response {
  // Body is never written by requireAdmin — it always either calls next()
  // or hands an AppError to next(). A minimal cast is enough for the tests.
  return {} as unknown as Response;
}

function makeReq(userId?: string): Request {
  return { user: userId ? { userId, email: "x@y.z" } : undefined } as unknown as Request;
}

describe("requireAdmin middleware", () => {
  const ORIGINAL = process.env.ADMIN_USER_IDS;

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env.ADMIN_USER_IDS;
    } else {
      process.env.ADMIN_USER_IDS = ORIGINAL;
    }
  });

  it("rejects with FORBIDDEN when ADMIN_USER_IDS is unset", () => {
    delete process.env.ADMIN_USER_IDS;
    const next = jest.fn() as unknown as NextFunction;
    requireAdmin(makeReq("user-1"), makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    const err = (next as jest.Mock).mock.calls[0][0] as AppError;
    expect(err.code).toBe("FORBIDDEN");
    expect(err.status).toBe(403);
  });

  it("rejects when ADMIN_USER_IDS is empty string", () => {
    process.env.ADMIN_USER_IDS = "   ";
    const next = jest.fn() as unknown as NextFunction;
    requireAdmin(makeReq("user-1"), makeRes(), next);
    expect((next as jest.Mock).mock.calls[0][0]).toBeInstanceOf(AppError);
  });

  it("rejects when the requesting user is not in the allowlist", () => {
    process.env.ADMIN_USER_IDS = "admin-a, admin-b";
    const next = jest.fn() as unknown as NextFunction;
    requireAdmin(makeReq("user-x"), makeRes(), next);
    const err = (next as jest.Mock).mock.calls[0][0] as AppError;
    expect(err.code).toBe("FORBIDDEN");
  });

  it("rejects when req.user is absent (e.g. requireAuth not run)", () => {
    process.env.ADMIN_USER_IDS = "admin-a";
    const next = jest.fn() as unknown as NextFunction;
    requireAdmin(makeReq(undefined), makeRes(), next);
    expect((next as jest.Mock).mock.calls[0][0]).toBeInstanceOf(AppError);
  });

  it("calls next() with no error when the user is in the allowlist", () => {
    process.env.ADMIN_USER_IDS = "admin-a, admin-b";
    const next = jest.fn() as unknown as NextFunction;
    requireAdmin(makeReq("admin-b"), makeRes(), next);
    expect(next).toHaveBeenCalledWith();
    // Crucially: not called with an error argument.
    expect((next as jest.Mock).mock.calls[0]).toHaveLength(0);
  });

  it("trims whitespace and ignores empty entries in the allowlist", () => {
    process.env.ADMIN_USER_IDS = " ,admin-a , , admin-b , ";
    const next = jest.fn() as unknown as NextFunction;
    requireAdmin(makeReq("admin-a"), makeRes(), next);
    expect((next as jest.Mock).mock.calls[0]).toHaveLength(0);
  });
});
