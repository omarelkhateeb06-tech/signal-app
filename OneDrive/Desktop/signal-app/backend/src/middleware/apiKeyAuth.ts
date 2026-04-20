import type { NextFunction, Request, Response } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { apiKeys } from "../db/schema";
import { hashApiKey } from "../services/apiKeyService";
import { AppError } from "./errorHandler";

export interface AuthenticatedApiKey {
  id: string;
  userId: string;
  label: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      apiKey?: AuthenticatedApiKey;
    }
  }
}

// Middleware for v2 (public Intelligence API) routes. JWT-authed endpoints
// under /api/v1/me/api-keys use requireAuth instead — this is strictly for
// programmatic callers presenting a key in the `X-API-Key` header.
export async function apiKeyAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const raw = req.header("x-api-key")?.trim();
  if (!raw) {
    next(new AppError("UNAUTHORIZED", "Missing X-API-Key header", 401));
    return;
  }

  // HMAC is deterministic, so we can look the key up by hash in O(1) rather
  // than scan every row and timing-safe-compare each. The hash column has a
  // unique index, and the HMAC secret prevents offline dictionary attacks
  // if the DB leaks.
  const keyHash = hashApiKey(raw);

  try {
    const rows = await db
      .select({
        id: apiKeys.id,
        userId: apiKeys.userId,
        label: apiKeys.label,
        revokedAt: apiKeys.revokedAt,
      })
      .from(apiKeys)
      .where(and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)))
      .limit(1);

    const row = rows[0];
    if (!row) {
      next(new AppError("UNAUTHORIZED", "Invalid or revoked API key", 401));
      return;
    }

    req.apiKey = { id: row.id, userId: row.userId, label: row.label };

    // Fire-and-forget last_used_at bump. We don't await because the request
    // shouldn't wait on a non-critical write, and we don't want an error
    // here to 500 an otherwise-valid request.
    void db
      .update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, row.id))
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error("[apiKeyAuth] failed to update last_used_at", err);
      });

    next();
  } catch (err) {
    next(err);
  }
}
