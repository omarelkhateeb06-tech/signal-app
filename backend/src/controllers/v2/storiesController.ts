import type { NextFunction, Request, Response } from "express";
import { and, desc, eq, gte, isNotNull, lte, lt, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { stories } from "../../db/schema";
import { AppError } from "../../middleware/errorHandler";
import { parseWhyItMattersTemplate } from "../../utils/depthVariants";

// Sectors are validated at the API boundary. The schema column is a plain
// varchar(50) with no DB-level enum constraint; codifying the list here
// gives callers a fail-fast 400 on typos instead of a silently-empty feed,
// and makes the enum part of the public API contract.
export const VALID_SECTORS = ["ai", "finance", "semiconductors"] as const;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

const querySchema = z.object({
  sector: z.enum(VALID_SECTORS).optional(),
  since: z
    .string()
    .datetime({ offset: true })
    .optional()
    .transform((v) => (v === undefined ? undefined : new Date(v))),
  until: z
    .string()
    .datetime({ offset: true })
    .optional()
    .transform((v) => (v === undefined ? undefined : new Date(v))),
  author: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  cursor: z.string().min(1).optional(),
});

interface CursorPayload {
  p: string; // published_at ISO
  i: string; // story id
}

function encodeCursor(publishedAt: Date, id: string): string {
  const json = JSON.stringify({ p: publishedAt.toISOString(), i: id });
  return Buffer.from(json, "utf8").toString("base64url");
}

function decodeCursor(raw: string): CursorPayload {
  try {
    const json = Buffer.from(raw, "base64url").toString("utf8");
    const parsed: unknown = JSON.parse(json);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as { p?: unknown }).p !== "string" ||
      typeof (parsed as { i?: unknown }).i !== "string"
    ) {
      throw new Error("malformed");
    }
    const p = (parsed as { p: string }).p;
    const i = (parsed as { i: string }).i;
    if (Number.isNaN(Date.parse(p))) throw new Error("malformed date");
    return { p, i };
  } catch {
    throw new AppError(
      "INVALID_CURSOR",
      "Cursor is invalid or expired. Start a new pagination from the beginning.",
      400,
    );
  }
}

export async function listStoriesV2(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parseResult = querySchema.safeParse(req.query);
    if (!parseResult.success) {
      throw new AppError(
        "INVALID_QUERY",
        "Invalid query parameters",
        400,
        parseResult.error.flatten(),
      );
    }
    const params = parseResult.data;

    const cursor = params.cursor === undefined ? undefined : decodeCursor(params.cursor);

    // v2 stories API only surfaces published content. Drafts (published_at
    // IS NULL) are excluded from every response regardless of caller filters.
    const conditions = [isNotNull(stories.publishedAt)];
    if (params.sector) conditions.push(eq(stories.sector, params.sector));
    if (params.since) conditions.push(gte(stories.publishedAt, params.since));
    if (params.until) conditions.push(lte(stories.publishedAt, params.until));
    if (params.author) conditions.push(eq(stories.authorId, params.author));
    if (cursor) {
      // Keyset pagination tuple: (published_at, id) < (cursor.p, cursor.i),
      // expanded to an explicit OR form for Drizzle/Postgres portability.
      // Order DESC on both columns means "less than" = "after" in the feed.
      const cursorDate = new Date(cursor.p);
      conditions.push(
        or(
          lt(stories.publishedAt, cursorDate),
          and(eq(stories.publishedAt, cursorDate), lt(stories.id, cursor.i)),
        )!,
      );
    }

    // Fetch one extra row to determine has_more without a separate COUNT.
    const rows = await db
      .select({
        id: stories.id,
        headline: stories.headline,
        // v2 API exposes `context` as "summary" — the schema column is named
        // "context" for historical reasons but semantically represents the
        // story body/description. If a dedicated summary column is added
        // later, swap the source without changing the public API shape.
        summary: stories.context,
        // Phase 12a projection fix (GH issue: Phase 12a P1 API-proj): the
        // commentary fields weren't surfacing to API consumers. `why_it_matters`
        // is the role-neutral fallback; `why_it_matters_template` is the
        // depth-variant payload parsed from TEXT-JSON at read time. The
        // lenient parser returns null on a legacy-shape or invalid row so
        // the endpoint keeps serving during the regeneration window.
        whyItMatters: stories.whyItMatters,
        whyItMattersTemplate: stories.whyItMattersTemplate,
        url: stories.sourceUrl,
        publishedAt: stories.publishedAt,
        sector: stories.sector,
      })
      .from(stories)
      .where(and(...conditions))
      .orderBy(desc(stories.publishedAt), desc(stories.id))
      .limit(params.limit + 1);

    const hasMore = rows.length > params.limit;
    const pageRows = hasMore ? rows.slice(0, params.limit) : rows;

    let nextCursor: string | null = null;
    if (hasMore) {
      const last = pageRows[pageRows.length - 1];
      if (last && last.publishedAt) {
        nextCursor = encodeCursor(last.publishedAt, last.id);
      }
    }

    res.json({
      data: pageRows.map((r) => ({
        id: r.id,
        headline: r.headline,
        summary: r.summary,
        why_it_matters: r.whyItMatters,
        why_it_matters_template: parseWhyItMattersTemplate(r.whyItMattersTemplate),
        url: r.url,
        published_at: r.publishedAt,
        sector: r.sector,
      })),
      pagination: {
        next_cursor: nextCursor,
        has_more: hasMore,
      },
    });
  } catch (error) {
    next(error);
  }
}
