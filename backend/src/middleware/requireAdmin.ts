import type { NextFunction, Request, Response } from "express";
import { AppError } from "./errorHandler";

// Phase 12e.8 — gate admin routes behind an env-var allowlist.
// ADMIN_USER_IDS is a comma-separated list of user UUIDs. If the env
// var is absent or empty, all admin requests are rejected — there is
// no open-admin fallback. Requires requireAuth to have run first so
// req.user is populated.
export function requireAdmin(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const raw = process.env.ADMIN_USER_IDS ?? "";
  const allowlist = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (allowlist.length === 0) {
    next(new AppError("FORBIDDEN", "Admin access not configured", 403));
    return;
  }

  if (!req.user || !allowlist.includes(req.user.userId)) {
    next(new AppError("FORBIDDEN", "Forbidden", 403));
    return;
  }

  next();
}
