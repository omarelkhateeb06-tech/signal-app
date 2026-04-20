import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError, errorHandler } from "../src/middleware/errorHandler";

function makeRes(): {
  res: Response;
  status: jest.Mock;
  json: jest.Mock;
} {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;
  return { res, status, json };
}

describe("errorHandler", () => {
  const req = {} as Request;
  const next: NextFunction = jest.fn();

  it.each(["ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND"])(
    "coerces pg %s error to a 503 DATABASE_UNAVAILABLE",
    (code) => {
      const { res, status } = makeRes();
      const err = Object.assign(new Error(`connect ${code}`), { code });

      errorHandler(err, req, res, next);

      expect(status).toHaveBeenCalledWith(503);
      const json = (status.mock.results[0]!.value as { json: jest.Mock }).json;
      expect(json).toHaveBeenCalledWith({
        error: {
          code: "DATABASE_UNAVAILABLE",
          message: "Database temporarily unavailable",
        },
      });
    },
  );

  it("does not treat non-pg errors with unrelated codes as 503", () => {
    const { res, status } = makeRes();
    const err = Object.assign(new Error("something else"), {
      code: "ERR_VALIDATION",
    });

    errorHandler(err, req, res, next);

    expect(status).toHaveBeenCalledWith(500);
  });

  it("still maps ZodError to 400 INVALID_INPUT", () => {
    const { res, status } = makeRes();
    const err = new ZodError([]);

    errorHandler(err, req, res, next);

    expect(status).toHaveBeenCalledWith(400);
  });

  it("still maps AppError to its status + code", () => {
    const { res, status } = makeRes();
    const err = new AppError("TEAPOT", "I'm a teapot", 418);

    errorHandler(err, req, res, next);

    expect(status).toHaveBeenCalledWith(418);
  });
});
