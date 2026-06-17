import type { NextFunction, Request, Response } from "express";
import { verifyToken } from "../services/authService";

// Attaches req.user when a valid Bearer token is present, but NEVER rejects:
// anonymous callers continue with req.user undefined. Used by the product-
// events sink, which captures pre-auth funnel events (landing, signup funnel)
// alongside authed ones. Contrast requireAuth, which 401s on a missing/invalid
// token. A malformed/expired token here is treated as anonymous, not an error —
// telemetry must never fail a beacon.
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) {
    const token = header.slice("Bearer ".length).trim();
    if (token) {
      try {
        req.user = verifyToken(token);
      } catch {
        // Invalid/expired token → fall through as anonymous.
      }
    }
  }
  next();
}
