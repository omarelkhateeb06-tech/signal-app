import type { NextFunction, Request, Response } from "express";
import { AppError } from "./errorHandler";
import { verifyToken, type JwtPayload } from "../services/authService";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    next(new AppError("UNAUTHORIZED", "Missing or malformed Authorization header", 401));
    return;
  }
  const token = header.slice("Bearer ".length).trim();
  if (!token) {
    next(new AppError("UNAUTHORIZED", "Missing bearer token", 401));
    return;
  }
  try {
    req.user = verifyToken(token);
    next();
  } catch {
    next(new AppError("UNAUTHORIZED", "Invalid or expired token", 401));
  }
}
