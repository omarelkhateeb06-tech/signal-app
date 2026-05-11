import type { NextFunction, Request, Response } from "express";
import { and, desc, eq, gte, inArray, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  events,
  eventSources,
  stories,
  userProfiles,
  userSaves,
  writers,
} from "../db/schema";
import { AppError } from "../middleware/errorHandler";
import { personalizeStory } from "../services/personalizationService";
import {
  EDGAR_PENALTY,
  EDGAR_SOURCE_SLUGS,
  FEED_MAX_STORIES,
  FRESHNESS_BONUS,
  FRESHNESS_QUALITY_THRESHOLD,
  FRESHNESS_WINDOW_HOURS,
  W1,
  W2,
} from "../feed/rankingConstants";

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 10;
const RELATED_LIMIT = 5;

const feedQuerySchema = z.object({
  sectors: z
    .string()
    .optional()
    .transform((raw) =>
      raw
        ? raw
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s.length > 0)
        : [],
    ),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  offset: z.coerce.number().int().min(0).default(0),
});

const idParamSchema = z.object({ id: z.string().uuid() });

function requireUserId(req: Request): string {
  if (!req.user) {
    throw new AppError("UNAUTHORIZED", "Not authenticated", 401);
  }
  return req.user.userId;
}

interface StoryRow {
  id: string;
  sector: string;
  headline: string;
  context: string;
  whyItMatters: string;
  whyItMattersTemplate: string | null;
  sourceUrl: string;
  sourceName: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  authorId: string | null;
  authorName: string | null;
  authorBio: string | null;
  isSaved: boolean;
  saveCount: number;
  commentCount: number;
}

function shapeStory(row: StoryRow, role: string | null): Record<string, unknown> {
  return {
    id: row.id,
    sector: row.sector,
    headline: row.headline,
    context: row.context,
    why_it_matters: row.whyItMatters,
    // Phase 12b personalization output — kept on the payload for
    // backward compatibility through the 12c rollout. The 12c client
    // prefers `commentary` once it arrives; the 12b field will be
    // removed in the 12d cleanup commit.
    why_it_matters_to_you: personalizeStory({
      whyItMatters: row.whyItMatters,
      whyItMattersTemplate: row.whyItMattersTemplate,
      role,
    }),
    // Phase 12c contract: feed-list responses never carry the
    // per-user commentary inline. The client hydrates it via
    // GET /stories/:id/commentary after the feed lands. Returning
    // nulls here (rather than omitting the keys) makes the "not yet
    // loaded" state explicit on the wire and lets TypeScript consumers
    // treat the field as `string | null` rather than `string | undefined`.
    // The `commentary_source` field is the null-mirror of
    // CommentaryResult.source — populated only by the dedicated endpoint.
    commentary: null,
    commentary_source: null,
    source_url: row.sourceUrl,
    source_name: row.sourceName,
    // Phase 12e.7a — multi-source attribution. Hand-curated stories
    // carry a synthetic single-element array so the wire shape is
    // uniform across legacy stories and ingestion-written events.
    primary_source_url: row.sourceUrl,
    sources: [
      { url: row.sourceUrl, name: row.sourceName, role: "primary" as const },
    ],
    published_at: row.publishedAt,
    created_at: row.createdAt,
    author: row.authorId
      ? { id: row.authorId, name: row.authorName, bio: row.authorBio }
      : null,
    is_saved: Boolean(row.isSaved),
    save_count: Number(row.saveCount ?? 0),
    comment_count: Number(row.commentCount ?? 0),
  };
}

// Phase 12e.7a — event-row shape and renderer. EventRow mirrors StoryRow
// where the columns line up; the divergent fields are
// `primarySourceUrl` / `primarySourceName` (denormalized on `events`)
// versus `sourceUrl` / `sourceName` (on `stories`). `sources` is fetched
// separately and passed in by the caller.
interface EventRow {
  id: string;
  sector: string;
  headline: string;
  context: string;
  whyItMatters: string;
  whyItMattersTemplate: string | null;
  primarySourceUrl: string;
  primarySourceName: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  authorId: string | null;
  authorName: string | null;
  authorBio: string | null;
  isSaved: boolean;
  saveCount: number;
  commentCount: number;
  // Phase 12f — ranking score computed in SQL. Used by the merge step
  // to sort events vs. legacy stories on a unified scale. Never sent
  // to the wire (shapeEvent strips it).
  effectiveScore: number;
}

interface EventSourceRow {
  url: string;
  name: string | null;
  role: string;
}

function shapeEvent(
  row: EventRow,
  role: string | null,
  sources: EventSourceRow[],
): Record<string, unknown> {
  return {
    id: row.id,
    sector: row.sector,
    headline: row.headline,
    context: row.context,
    why_it_matters: row.whyItMatters,
    why_it_matters_to_you: personalizeStory({
      whyItMatters: row.whyItMatters,
      whyItMattersTemplate: row.whyItMattersTemplate,
      role,
    }),
    commentary: null,
    commentary_source: null,
    // `source_url` and `source_name` are kept on the wire for
    // backward compatibility with v1 consumers — they reflect the
    // primary source. New consumers should read `sources` for the
    // full attribution list.
    source_url: row.primarySourceUrl,
    source_name: row.primarySourceName,
    primary_source_url: row.primarySourceUrl,
    sources,
    published_at: row.publishedAt,
    created_at: row.createdAt,
    author: row.authorId
      ? { id: row.authorId, name: row.authorName, bio: row.authorBio }
      : null,
    is_saved: Boolean(row.isSaved),
    save_count: Number(row.saveCount ?? 0),
    comment_count: Number(row.commentCount ?? 0),
  };
}

function isSavedExpr(userId: string): ReturnType<typeof sql<boolean>> {
  return sql<boolean>`EXISTS (SELECT 1 FROM user_saves us WHERE us.story_id = ${stories.id} AND us.user_id = ${userId})`;
}

function saveCountExpr(): ReturnType<typeof sql<number>> {
  return sql<number>`(SELECT COUNT(*)::int FROM user_saves us WHERE us.story_id = ${stories.id})`;
}

function commentCountExpr(): ReturnType<typeof sql<number>> {
  return sql<number>`(SELECT COUNT(*)::int FROM comments c WHERE c.story_id = ${stories.id} AND c.deleted_at IS NULL)`;
}

// Phase 12e.7a — event-side equivalents of the three subquery helpers
// above. The `is_saved` / `save_count` / `comment_count` semantics on the
// API payload are unchanged; the difference is which FK column the
// subquery targets.
function isEventSavedExpr(userId: string): ReturnType<typeof sql<boolean>> {
  return sql<boolean>`EXISTS (
    SELECT 1 FROM user_saves us
    WHERE us.event_id = ${events.id} AND us.user_id = ${userId}
  )`;
}

function eventSaveCountExpr(): ReturnType<typeof sql<number>> {
  return sql<number>`(SELECT COUNT(*)::int FROM user_saves us WHERE us.event_id = ${events.id})`;
}

function eventCommentCountExpr(): ReturnType<typeof sql<number>> {
  return sql<number>`(SELECT COUNT(*)::int FROM comments c WHERE c.event_id = ${events.id} AND c.deleted_at IS NULL)`;
}

// Phase 12f — ranking expressions for the events query. Each helper is
// a SQL fragment, composable inside the SELECT list and the ORDER BY.
// The composite `eventEffectiveScoreExpr()` mirrors the TS function
// `calculateEffectiveScore` in src/feed/calculateEffectiveScore.ts —
// the TS function exists for unit tests; the SQL is canonical for
// production. Keep them in lockstep.

/**
 * Quality score of the event's primary source, looked up via the
 * `role='primary'` event_sources row. Falls back to 5 (the schema
 * default on ingestion_sources.quality_score) when no primary source
 * row exists, which is rare but possible for legacy event rows.
 */
function eventQualityScoreExpr(): ReturnType<typeof sql<number>> {
  return sql<number>`COALESCE(
    (SELECT isrc.quality_score
       FROM event_sources es
       JOIN ingestion_sources isrc ON isrc.id = es.ingestion_source_id
       WHERE es.event_id = ${events.id} AND es.role = 'primary'
       LIMIT 1),
    5
  )`;
}

/**
 * Number of *alternate* event_sources attached to this event. Equal to
 * (total event_sources rows − 1); a solo event passes 0. Guarded by
 * GREATEST so an orphaned event with zero sources doesn't underflow.
 */
function eventAlternatesCountExpr(): ReturnType<typeof sql<number>> {
  return sql<number>`GREATEST(0, (SELECT COUNT(*)::int - 1 FROM event_sources es WHERE es.event_id = ${events.id}))`;
}

/**
 * Age of the event in hours since published_at (or created_at if
 * published_at is null). Float — fractional hours preserved.
 */
function eventAgeHoursExpr(): ReturnType<typeof sql<number>> {
  return sql<number>`(EXTRACT(EPOCH FROM (NOW() - COALESCE(${events.publishedAt}, ${events.createdAt}))) / 3600.0)`;
}

/**
 * True iff the event has exactly one event_sources row AND that
 * source's slug is in EDGAR_SOURCE_SLUGS. Used as the first half of
 * the EDGAR-penalty gate.
 */
function eventIsEdgarSoleSourceExpr(): ReturnType<typeof sql<boolean>> {
  const slugList = sql.join(
    EDGAR_SOURCE_SLUGS.map((slug) => sql`${slug}`),
    sql`, `,
  );
  return sql<boolean>`(
    (SELECT COUNT(*) FROM event_sources es WHERE es.event_id = ${events.id}) = 1
    AND EXISTS (
      SELECT 1 FROM event_sources es
        JOIN ingestion_sources isrc ON isrc.id = es.ingestion_source_id
        WHERE es.event_id = ${events.id} AND isrc.slug IN (${slugList})
    )
  )`;
}

/**
 * True iff at least one ingestion_candidate resolved to this event has
 * non-empty body_text. False = body enrichment never produced usable
 * text, which (combined with `isEdgarSoleSource`) triggers the EDGAR
 * penalty.
 */
function eventBodyTextPresentExpr(): ReturnType<typeof sql<boolean>> {
  return sql<boolean>`EXISTS (
    SELECT 1 FROM ingestion_candidates ic
      WHERE ic.resolved_event_id = ${events.id}
        AND ic.body_text IS NOT NULL
        AND ic.body_text <> ''
  )`;
}

/**
 * Composite effective_score expression. Used both as a SELECT column
 * (so the row carries its score for downstream sort/inspection) and in
 * the ORDER BY clause.
 */
function eventEffectiveScoreExpr(): ReturnType<typeof sql<number>> {
  const quality = eventQualityScoreExpr();
  const alternates = eventAlternatesCountExpr();
  const ageHours = eventAgeHoursExpr();
  const isEdgarSole = eventIsEdgarSoleSourceExpr();
  const bodyPresent = eventBodyTextPresentExpr();

  return sql<number>`(
    ${quality}::numeric
    + ${W1}::numeric * LN(1 + ${alternates}::numeric)
    - ${W2}::numeric * ${ageHours}::numeric
    + CASE
        WHEN ${quality}::numeric >= ${FRESHNESS_QUALITY_THRESHOLD}::numeric
          AND ${ageHours}::numeric <= ${FRESHNESS_WINDOW_HOURS}::numeric
        THEN ${FRESHNESS_BONUS}::numeric
        ELSE 0::numeric
      END
    - CASE
        WHEN ${isEdgarSole} AND NOT ${bodyPresent}
        THEN ${EDGAR_PENALTY}::numeric
        ELSE 0::numeric
      END
  )`;
}

/**
 * Static baseline score assigned to legacy hand-curated stories so
 * they sort coherently against ranked events in the merge step.
 * Stories are evergreen seed content (the 20 rows in
 * seed-data/stories.json) and don't have ingestion_sources rows to
 * derive a quality_score from. Pegged at the editorial mid-tier so
 * they surface above low-quality events but below freshness-bonused
 * primary-lab events.
 */
const STORY_BASELINE_EFFECTIVE_SCORE = 7;

const baseStoryColumns = {
  id: stories.id,
  sector: stories.sector,
  headline: stories.headline,
  context: stories.context,
  whyItMatters: stories.whyItMatters,
  whyItMattersTemplate: stories.whyItMattersTemplate,
  sourceUrl: stories.sourceUrl,
  sourceName: stories.sourceName,
  publishedAt: stories.publishedAt,
  createdAt: stories.createdAt,
  authorId: writers.id,
  authorName: writers.name,
  authorBio: writers.bio,
};

export async function getFeed(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { sectors: requestedSectors, limit, offset } = feedQuerySchema.parse(req.query);

    const [profile] = await db
      .select({ sectors: userProfiles.sectors, role: userProfiles.role })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .limit(1);

    const profileSectors = profile?.sectors ?? [];
    const sectorsFilter = requestedSectors.length > 0 ? requestedSectors : profileSectors;

    // Phase 12f — sector filter is a *hard* WHERE (applied before
    // ranking). An empty `sectorsFilter` means the user hasn't picked
    // any sectors and didn't pass a `?sectors=` query param; in that
    // case we return all sectors rather than empty (CLAUDE.md feed
    // behavior).
    const storiesSectorWhere =
      sectorsFilter.length > 0 ? inArray(stories.sector, sectorsFilter) : undefined;
    const eventsSectorWhere =
      sectorsFilter.length > 0 ? inArray(events.sector, sectorsFilter) : undefined;

    // Phase 12e.7a — dual-read across `stories` (legacy hand-curated,
    // 20 rows) and `events` (ingestion-written, the bulk). Stories keep
    // their chronological order (no ranking inputs apply); events are
    // ranked via the 12f effective_score expression.
    const storyRows = (await db
      .select({
        ...baseStoryColumns,
        isSaved: isSavedExpr(userId),
        saveCount: saveCountExpr(),
        commentCount: commentCountExpr(),
      })
      .from(stories)
      .leftJoin(writers, eq(writers.id, stories.authorId))
      .where(storiesSectorWhere)
      .orderBy(desc(sql`COALESCE(${stories.publishedAt}, ${stories.createdAt})`))
      .limit(limit)
      .offset(offset)) as StoryRow[];

    // Phase 12f — events query is ranked by effective_score DESC and
    // capped at FEED_MAX_STORIES (the top-N pool). User-supplied limit
    // and offset paginate the merged result downstream; the SQL-level
    // cap is the candidate pool size, not the page size.
    const eventEffectiveScore = eventEffectiveScoreExpr();
    const eventRows = (await db
      .select({
        id: events.id,
        sector: events.sector,
        headline: events.headline,
        context: events.context,
        whyItMatters: events.whyItMatters,
        whyItMattersTemplate: events.whyItMattersTemplate,
        primarySourceUrl: events.primarySourceUrl,
        primarySourceName: events.primarySourceName,
        publishedAt: events.publishedAt,
        createdAt: events.createdAt,
        authorId: writers.id,
        authorName: writers.name,
        authorBio: writers.bio,
        isSaved: isEventSavedExpr(userId),
        saveCount: eventSaveCountExpr(),
        commentCount: eventCommentCountExpr(),
        effectiveScore: eventEffectiveScore,
      })
      .from(events)
      .leftJoin(writers, eq(writers.id, events.authorId))
      .where(eventsSectorWhere)
      .orderBy(desc(eventEffectiveScore))
      .limit(FEED_MAX_STORIES)) as EventRow[];

    type MergedItem =
      | { _type: "story"; row: StoryRow; sortKey: number }
      | { _type: "event"; row: EventRow; sortKey: number };
    const merged: MergedItem[] = [
      ...storyRows.map(
        (row): MergedItem => ({
          _type: "story",
          row,
          sortKey: STORY_BASELINE_EFFECTIVE_SCORE,
        }),
      ),
      ...eventRows.map(
        (row): MergedItem => ({
          _type: "event",
          row,
          // `effectiveScore` comes back as numeric → string from pg in
          // some configurations; coerce defensively.
          sortKey: Number(row.effectiveScore),
        }),
      ),
    ];
    merged.sort((a, b) => {
      if (b.sortKey !== a.sortKey) return b.sortKey - a.sortKey;
      // Stable tiebreaker: newer first.
      const aTs = (a.row.publishedAt ?? a.row.createdAt).getTime();
      const bTs = (b.row.publishedAt ?? b.row.createdAt).getTime();
      return bTs - aTs;
    });
    const pageItems = merged.slice(0, limit);

    // Batch-fetch event_sources for whichever event items survived the
    // merge slice. Skip the round-trip when no events are on the page.
    const eventIds = pageItems
      .filter((m): m is { _type: "event"; row: EventRow; sortKey: number } => m._type === "event")
      .map((m) => m.row.id);
    const allSources =
      eventIds.length > 0
        ? await db
            .select({
              eventId: eventSources.eventId,
              url: eventSources.url,
              name: eventSources.name,
              role: eventSources.role,
            })
            .from(eventSources)
            .where(inArray(eventSources.eventId, eventIds))
        : [];
    const sourcesByEventId = new Map<string, EventSourceRow[]>();
    for (const s of allSources) {
      const arr = sourcesByEventId.get(s.eventId) ?? [];
      arr.push({ url: s.url, name: s.name, role: s.role });
      sourcesByEventId.set(s.eventId, arr);
    }

    // Counts: union total = stories matching sectors + events matching sectors.
    // Same optional-WHERE semantics as the main queries above: when the
    // user has no sectors, count all rows.
    const [storiesCountRow] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(stories)
      .where(storiesSectorWhere);
    const [eventsCountRow] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(events)
      .where(eventsSectorWhere);
    const total =
      Number(storiesCountRow?.count ?? 0) + Number(eventsCountRow?.count ?? 0);

    const shaped = pageItems.map((m) =>
      m._type === "story"
        ? shapeStory(m.row, profile?.role ?? null)
        : shapeEvent(
            m.row,
            profile?.role ?? null,
            sourcesByEventId.get(m.row.id) ?? [],
          ),
    );

    res.json({
      data: {
        stories: shaped,
        total,
        has_more: offset + pageItems.length < total,
        limit,
        offset,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getStoryById(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = idParamSchema.parse(req.params);

    const [profile] = await db
      .select({ role: userProfiles.role })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .limit(1);

    const [row] = (await db
      .select({
        ...baseStoryColumns,
        isSaved: isSavedExpr(userId),
        saveCount: saveCountExpr(),
        commentCount: commentCountExpr(),
      })
      .from(stories)
      .leftJoin(writers, eq(writers.id, stories.authorId))
      .where(eq(stories.id, id))
      .limit(1)) as StoryRow[];

    if (!row) {
      // Phase 12e.7a — events fallback. The id may name an
      // ingestion-written event rather than a hand-curated story.
      const [eventRow] = (await db
        .select({
          id: events.id,
          sector: events.sector,
          headline: events.headline,
          context: events.context,
          whyItMatters: events.whyItMatters,
          whyItMattersTemplate: events.whyItMattersTemplate,
          primarySourceUrl: events.primarySourceUrl,
          primarySourceName: events.primarySourceName,
          publishedAt: events.publishedAt,
          createdAt: events.createdAt,
          authorId: writers.id,
          authorName: writers.name,
          authorBio: writers.bio,
          isSaved: isEventSavedExpr(userId),
          saveCount: eventSaveCountExpr(),
          commentCount: eventCommentCountExpr(),
        })
        .from(events)
        .leftJoin(writers, eq(writers.id, events.authorId))
        .where(eq(events.id, id))
        .limit(1)) as EventRow[];

      if (!eventRow) {
        throw new AppError("STORY_NOT_FOUND", "Story not found", 404);
      }

      const sources = await db
        .select({
          url: eventSources.url,
          name: eventSources.name,
          role: eventSources.role,
        })
        .from(eventSources)
        .where(eq(eventSources.eventId, id));

      res.json({
        data: { story: shapeEvent(eventRow, profile?.role ?? null, sources) },
      });
      return;
    }

    res.json({ data: { story: shapeStory(row, profile?.role ?? null) } });
  } catch (error) {
    next(error);
  }
}

// Phase 12e.7a — saves can target either a story or an event. Counts
// match on whichever FK column carries the id; the CHECK constraint at
// the DB level guarantees exactly one is non-null per row, so the OR
// here doesn't double-count.
async function countSaves(itemId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(userSaves)
    .where(or(eq(userSaves.storyId, itemId), eq(userSaves.eventId, itemId)));
  return Number(row?.count ?? 0);
}

export async function saveStory(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = idParamSchema.parse(req.params);

    // Dispatch on whether the id names a story or an event. UUIDs are
    // generated globally so there's no namespace collision risk.
    const [storyCheck] = await db
      .select({ id: stories.id })
      .from(stories)
      .where(eq(stories.id, id))
      .limit(1);

    if (storyCheck) {
      await db
        .insert(userSaves)
        .values({ userId, storyId: id })
        .onConflictDoNothing({
          target: [userSaves.userId, userSaves.storyId],
        });
    } else {
      const [eventCheck] = await db
        .select({ id: events.id })
        .from(events)
        .where(eq(events.id, id))
        .limit(1);
      if (!eventCheck) {
        throw new AppError("STORY_NOT_FOUND", "Story not found", 404);
      }
      await db
        .insert(userSaves)
        .values({ userId, eventId: id })
        .onConflictDoNothing();
    }

    const saveCount = await countSaves(id);
    res.json({ data: { saved: true, save_count: saveCount } });
  } catch (error) {
    next(error);
  }
}

export async function unsaveStory(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = idParamSchema.parse(req.params);

    await db
      .delete(userSaves)
      .where(
        and(
          eq(userSaves.userId, userId),
          or(eq(userSaves.storyId, id), eq(userSaves.eventId, id)),
        ),
      );

    const saveCount = await countSaves(id);
    res.json({ data: { saved: false, save_count: saveCount } });
  } catch (error) {
    next(error);
  }
}

const savesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

interface SavedStoryRow extends StoryRow {
  savedAt: Date;
}

export async function listMySaves(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { limit, offset } = savesQuerySchema.parse(req.query);

    const [profile] = await db
      .select({ role: userProfiles.role })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .limit(1);

    const rows = (await db
      .select({
        ...baseStoryColumns,
        isSaved: sql<boolean>`TRUE`,
        saveCount: saveCountExpr(),
        commentCount: commentCountExpr(),
        savedAt: userSaves.savedAt,
      })
      .from(userSaves)
      .innerJoin(stories, eq(stories.id, userSaves.storyId))
      .leftJoin(writers, eq(writers.id, stories.authorId))
      .where(eq(userSaves.userId, userId))
      .orderBy(desc(userSaves.savedAt))
      .limit(limit)
      .offset(offset)) as SavedStoryRow[];

    const [countRow] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(userSaves)
      .where(eq(userSaves.userId, userId));
    const total = Number(countRow?.count ?? 0);

    const shaped = rows.map((row) => ({
      ...shapeStory(row, profile?.role ?? null),
      saved_at: row.savedAt,
    }));

    res.json({
      data: {
        stories: shaped,
        total,
        has_more: offset + rows.length < total,
        limit,
        offset,
      },
    });
  } catch (error) {
    next(error);
  }
}

const MAX_QUERY_LENGTH = 200;

const searchQuerySchema = z.object({
  q: z.string().trim().min(2).max(MAX_QUERY_LENGTH),
  sector: z.string().trim().min(1).optional(),
  from_date: z
    .string()
    .datetime({ offset: true })
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
    .optional(),
  to_date: z
    .string()
    .datetime({ offset: true })
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
    .optional(),
  sort: z.enum(["relevance", "newest", "most_saved"]).default("relevance"),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

function parseBoundaryDate(value: string, end: boolean): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T${end ? "23:59:59.999" : "00:00:00.000"}Z`);
  }
  return new Date(value);
}

export async function searchStories(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const parsed = searchQuerySchema.parse(req.query);

    const fromDate = parsed.from_date
      ? parseBoundaryDate(parsed.from_date, false)
      : undefined;
    const toDate = parsed.to_date
      ? parseBoundaryDate(parsed.to_date, true)
      : undefined;

    if (fromDate && Number.isNaN(fromDate.getTime())) {
      throw new AppError("INVALID_INPUT", "Invalid from_date", 400);
    }
    if (toDate && Number.isNaN(toDate.getTime())) {
      throw new AppError("INVALID_INPUT", "Invalid to_date", 400);
    }

    const [profile] = await db
      .select({ role: userProfiles.role })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .limit(1);

    const tsVector = sql`to_tsvector('english', coalesce(${stories.headline}, '') || ' ' || coalesce(${stories.context}, ''))`;
    const tsQuery = sql`websearch_to_tsquery('english', ${parsed.q})`;
    const rankExpr = sql<number>`ts_rank(${tsVector}, ${tsQuery})`;

    const clauses: SQL[] = [sql`${tsVector} @@ ${tsQuery}`];
    if (parsed.sector) clauses.push(eq(stories.sector, parsed.sector));
    if (fromDate) clauses.push(gte(stories.publishedAt, fromDate));
    if (toDate) clauses.push(lte(stories.publishedAt, toDate));
    const whereCondition = clauses.length === 1 ? clauses[0] : and(...clauses);

    const orderBy =
      parsed.sort === "newest"
        ? desc(sql`COALESCE(${stories.publishedAt}, ${stories.createdAt})`)
        : parsed.sort === "most_saved"
          ? desc(saveCountExpr())
          : desc(rankExpr);

    const rows = (await db
      .select({
        ...baseStoryColumns,
        isSaved: isSavedExpr(userId),
        saveCount: saveCountExpr(),
        commentCount: commentCountExpr(),
        rank: rankExpr,
      })
      .from(stories)
      .leftJoin(writers, eq(writers.id, stories.authorId))
      .where(whereCondition)
      .orderBy(orderBy)
      .limit(parsed.limit)
      .offset(parsed.offset)) as Array<StoryRow & { rank: number }>;

    const [countRow] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(stories)
      .where(whereCondition);
    const total = Number(countRow?.count ?? 0);

    const shaped = rows.map((row) => ({
      ...shapeStory(row, profile?.role ?? null),
      rank: Number(row.rank ?? 0),
    }));

    res.json({
      data: {
        stories: shaped,
        total,
        has_more: parsed.offset + rows.length < total,
        limit: parsed.limit,
        offset: parsed.offset,
        query: parsed.q,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getRelatedStories(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const { id } = idParamSchema.parse(req.params);

    const [current] = await db
      .select({ id: stories.id, sector: stories.sector })
      .from(stories)
      .where(eq(stories.id, id))
      .limit(1);
    if (!current) {
      throw new AppError("STORY_NOT_FOUND", "Story not found", 404);
    }

    const [profile] = await db
      .select({ role: userProfiles.role })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .limit(1);

    const rows = (await db
      .select({
        ...baseStoryColumns,
        isSaved: isSavedExpr(userId),
        saveCount: saveCountExpr(),
        commentCount: commentCountExpr(),
      })
      .from(stories)
      .leftJoin(writers, eq(writers.id, stories.authorId))
      .where(and(eq(stories.sector, current.sector), ne(stories.id, current.id)))
      .orderBy(desc(sql`COALESCE(${stories.publishedAt}, ${stories.createdAt})`))
      .limit(RELATED_LIMIT)) as StoryRow[];

    const shaped = rows.map((row) => shapeStory(row, profile?.role ?? null));
    res.json({ data: { stories: shaped } });
  } catch (error) {
    next(error);
  }
}
