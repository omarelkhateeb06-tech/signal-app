import type { NextFunction, Request, Response } from "express";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { apiKeys } from "../db/schema";
import { generateApiKey } from "../services/apiKeyService";
import { AppError } from "../middleware/errorHandler";

const LABEL_MAX_LENGTH = 100;
const MAX_ACTIVE_KEYS_PER_USER = 10;

const createKeySchema = z.object({
  label: z.string().trim().min(1).max(LABEL_MAX_LENGTH),
});

const idParamSchema = z.object({
  id: z.string().uuid(),
});

function requireUserId(req: Request): string {
  if (!req.user) {
    throw new AppError("UNAUTHORIZED", "Not authenticated", 401);
  }
  return req.user.userId;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "23505"
  );
}

export async function createApiKey(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { label } = createKeySchema.parse(req.body);

    const activeCount = await db
      .select({ id: apiKeys.id })
      .from(apiKeys)
      .where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)));
    if (activeCount.length >= MAX_ACTIVE_KEYS_PER_USER) {
      throw new AppError(
        "API_KEY_LIMIT_REACHED",
        `Active key limit reached (${MAX_ACTIVE_KEYS_PER_USER}). Revoke an existing key first.`,
        409,
      );
    }

    const generated = generateApiKey();

    let inserted;
    try {
      [inserted] = await db
        .insert(apiKeys)
        .values({
          userId,
          label,
          keyPrefix: generated.keyPrefix,
          keyHash: generated.keyHash,
        })
        .returning({
          id: apiKeys.id,
          label: apiKeys.label,
          keyPrefix: apiKeys.keyPrefix,
          createdAt: apiKeys.createdAt,
        });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new AppError(
          "API_KEY_LABEL_TAKEN",
          "An active API key with that label already exists",
          409,
        );
      }
      throw err;
    }

    if (!inserted) {
      throw new AppError("API_KEY_CREATE_FAILED", "Failed to create API key", 500);
    }

    // Full key is returned exactly once. We never store it, and the client
    // must save it immediately — subsequent list calls return only the
    // prefix.
    res.status(201).json({
      data: {
        id: inserted.id,
        label: inserted.label,
        key_prefix: inserted.keyPrefix,
        created_at: inserted.createdAt,
        key: generated.fullKey,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function listApiKeys(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);

    const rows = await db
      .select({
        id: apiKeys.id,
        label: apiKeys.label,
        keyPrefix: apiKeys.keyPrefix,
        createdAt: apiKeys.createdAt,
        lastUsedAt: apiKeys.lastUsedAt,
        revokedAt: apiKeys.revokedAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.userId, userId))
      .orderBy(asc(apiKeys.revokedAt), desc(apiKeys.createdAt));

    res.json({
      data: {
        keys: rows.map((r) => ({
          id: r.id,
          label: r.label,
          key_prefix: r.keyPrefix,
          created_at: r.createdAt,
          last_used_at: r.lastUsedAt,
          revoked_at: r.revokedAt,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function revokeApiKey(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = idParamSchema.parse(req.params);

    // Idempotent: only set revoked_at if currently NULL. Repeated DELETEs
    // return 204 without overwriting the original revocation time and
    // without leaking whether the key ever existed for this user.
    await db
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(apiKeys.id, id),
          eq(apiKeys.userId, userId),
          isNull(apiKeys.revokedAt),
        ),
      );

    res.status(204).end();
  } catch (error) {
    next(error);
  }
}
