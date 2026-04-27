import type { Request, RequestHandler, Response } from "express";

export const notFoundHandler: RequestHandler = (req: Request, res: Response): void => {
  res.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: `Route not found: ${req.method} ${req.originalUrl}`,
    },
  });
};
