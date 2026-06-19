// Belief maintenance — the missionary pivot's API.
//
// CRUD over the reader's working assumptions, plus the "Reconsider" ritual:
// runChallenges asks Haiku, per active belief, which of the week's developments
// most bears on it and how (contradicts / pressures / supports / watch — the
// hybrid "loud + radar"), and persists the verdict to belief_challenges (which
// doubles as the per-week cache). respondToChallenge records the reader's
// verdict — 'revised' is the north star (a logged belief_revised product_event
// = an assumption updated).
//
// Cost discipline: runChallenges is the only Haiku path here. It skips beliefs
// already checked this week (cost guard), caps beliefs per run, and matches in
// parallel (each call carries the service's own 10s timeout / fail-closed). A
// manual "Re-check" (force) bypasses the cost guard for a fresh pulse.

import type { NextFunction, Request, Response } from "express";
import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  beliefChallenges,
  events,
  productEvents,
  userBeliefs,
  userProfiles,
} from "../db/schema";
import { AppError } from "../middleware/errorHandler";
import {
  isoWeekKey,
  matchBeliefAgainstEvents,
  type BeliefMatchEvent,
} from "../services/beliefMatchService";

const MAX_BELIEF_LENGTH = 280;
const MAX_HORIZON_LENGTH = 80;
const MAX_BREAKER_LENGTH = 280;
const MIN_CONVICTION = 1;
const MAX_CONVICTION = 5;
const VALID_SECTORS = ["ai", "finance", "semiconductors"] as const;
// Widened from 10: the hybrid matcher does its own relevance ranking over the
// candidate set (embeddings proved near-orthogonal for short-belief→long-doc
// retrieval, so Haiku ranks instead). A wider recent in-sector set gives it
// more to find the genuinely-relevant development in.
const CANDIDATE_EVENT_LIMIT = 30;
const MAX_BELIEFS_PER_RUN = 10;
const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
// Per-candidate gist budget. The first matcher fed one sentence (~220 chars)
// and stayed blind to the substance; the radar needs enough of the
// why-it-matters to judge the relationship.
const GIST_MAX_CHARS = 360;

function requireUserId(req: Request): string {
  if (!req.user) throw new AppError("UNAUTHORIZED", "Not authenticated", 401);
  return req.user.userId;
}

// Gist for the matcher prompt — generic_commentary (role-neutral) preferred,
// why_it_matters fallback; the substance, trimmed to a budget on a word
// boundary (not just the first sentence — the radar needs enough to judge).
function gistFor(genericCommentary: string | null, whyItMatters: string): string {
  const source = (genericCommentary?.trim() || whyItMatters || "").trim();
  if (source.length <= GIST_MAX_CHARS) return source;
  const cut = source.slice(0, GIST_MAX_CHARS);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

const createSchema = z.object({
  statement: z.string().trim().min(8).max(MAX_BELIEF_LENGTH),
  sector: z.enum(VALID_SECTORS).nullish(),
  // Tripwire position fields (all optional): how strongly held (1-5), the
  // bet's time frame, and the explicit falsifier.
  conviction: z.number().int().min(MIN_CONVICTION).max(MAX_CONVICTION).nullish(),
  horizon: z.string().trim().max(MAX_HORIZON_LENGTH).nullish(),
  whatWouldBreakIt: z.string().trim().max(MAX_BREAKER_LENGTH).nullish(),
});

const updateSchema = z
  .object({
    statement: z.string().trim().min(8).max(MAX_BELIEF_LENGTH).optional(),
    status: z.enum(["active", "revised", "archived"]).optional(),
    conviction: z.number().int().min(MIN_CONVICTION).max(MAX_CONVICTION).nullish(),
    horizon: z.string().trim().max(MAX_HORIZON_LENGTH).nullish(),
    whatWouldBreakIt: z.string().trim().max(MAX_BREAKER_LENGTH).nullish(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), {
    message: "Nothing to update",
  });

const MAX_NOTE_LENGTH = 1000;
const respondSchema = z.object({
  // Belief Evolution (partial B): 'strengthened' is the growth half of the
  // north star — knowledge reinforced conviction, no revision. 'revised' stays
  // the update signal. 'note' is the reader's own words on how it moved them.
  response: z.enum(["revised", "strengthened", "held", "dismissed"]),
  note: z.string().trim().max(MAX_NOTE_LENGTH).nullish(),
});

const uuidSchema = z.string().uuid();

// Shared projection for the "Reconsider" view: a challenge joined to its
// belief. Used by both getChallenges and runChallenges' return.
async function loadWeekChallenges(
  userId: string,
  weekKey: string,
): Promise<unknown[]> {
  return db
    .select({
      id: beliefChallenges.id,
      belief_id: beliefChallenges.beliefId,
      statement: userBeliefs.statement,
      sector: userBeliefs.sector,
      relevance: beliefChallenges.relevance,
      how_to_update: beliefChallenges.howToUpdate,
      dissent: beliefChallenges.dissent,
      source_headline: beliefChallenges.sourceHeadline,
      event_id: beliefChallenges.eventId,
      response: beliefChallenges.response,
      created_at: beliefChallenges.createdAt,
    })
    .from(beliefChallenges)
    .innerJoin(userBeliefs, eq(beliefChallenges.beliefId, userBeliefs.id))
    .where(
      and(
        eq(beliefChallenges.userId, userId),
        eq(beliefChallenges.weekKey, weekKey),
      ),
    )
    .orderBy(desc(beliefChallenges.createdAt));
}

// ---------- CRUD ----------

export async function createBelief(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError("INVALID_BODY", "Invalid belief", 400, parsed.error.flatten());
    }
    const [row] = await db
      .insert(userBeliefs)
      .values({
        userId,
        statement: parsed.data.statement,
        sector: parsed.data.sector ?? null,
        conviction: parsed.data.conviction ?? null,
        horizon: parsed.data.horizon?.trim() || null,
        whatWouldBreakIt: parsed.data.whatWouldBreakIt?.trim() || null,
      })
      .returning();
    res.status(201).json({ data: { belief: row } });
  } catch (error) {
    next(error);
  }
}

export async function listBeliefs(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const rows = await db
      .select()
      .from(userBeliefs)
      .where(
        and(
          eq(userBeliefs.userId, userId),
          inArray(userBeliefs.status, ["active", "revised"]),
        ),
      )
      .orderBy(desc(userBeliefs.createdAt));
    res.json({ data: { beliefs: rows } });
  } catch (error) {
    next(error);
  }
}

export async function updateBelief(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const id = uuidSchema.safeParse(req.params.id);
    if (!id.success) throw new AppError("INVALID_QUERY", "Invalid belief id", 400);
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError("INVALID_BODY", "Invalid update", 400, parsed.error.flatten());
    }
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.data.statement !== undefined) set.statement = parsed.data.statement;
    if (parsed.data.status !== undefined) set.status = parsed.data.status;
    if (parsed.data.conviction !== undefined)
      set.conviction = parsed.data.conviction ?? null;
    if (parsed.data.horizon !== undefined)
      set.horizon = parsed.data.horizon?.trim() || null;
    if (parsed.data.whatWouldBreakIt !== undefined)
      set.whatWouldBreakIt = parsed.data.whatWouldBreakIt?.trim() || null;
    const [row] = await db
      .update(userBeliefs)
      .set(set)
      .where(and(eq(userBeliefs.id, id.data), eq(userBeliefs.userId, userId)))
      .returning();
    if (!row) throw new AppError("NOT_FOUND", "Belief not found", 404);
    res.json({ data: { belief: row } });
  } catch (error) {
    next(error);
  }
}

export async function deleteBelief(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const id = uuidSchema.safeParse(req.params.id);
    if (!id.success) throw new AppError("INVALID_QUERY", "Invalid belief id", 400);
    const [row] = await db
      .delete(userBeliefs)
      .where(and(eq(userBeliefs.id, id.data), eq(userBeliefs.userId, userId)))
      .returning();
    if (!row) throw new AppError("NOT_FOUND", "Belief not found", 404);
    res.json({ data: { deleted: true } });
  } catch (error) {
    next(error);
  }
}

// ---------- Reconsider ritual ----------

export async function getChallenges(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const weekKey = isoWeekKey(new Date());
    const challenges = await loadWeekChallenges(userId, weekKey);
    res.json({ data: { week: weekKey, challenges } });
  } catch (error) {
    next(error);
  }
}

export async function runChallenges(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const weekKey = isoWeekKey(new Date());
    // Manual "Re-check" forces a fresh run: it bypasses the per-week cost guard
    // and clears this week's unresponded challenges so the matcher regenerates
    // them. Challenges the reader already acted on (responded) are kept — both
    // as north-star data and so we don't re-spend Haiku on settled beliefs.
    const force = (req.body as { force?: unknown } | undefined)?.force === true;

    const beliefs = await db
      .select()
      .from(userBeliefs)
      .where(and(eq(userBeliefs.userId, userId), eq(userBeliefs.status, "active")))
      .orderBy(desc(userBeliefs.createdAt))
      .limit(MAX_BELIEFS_PER_RUN);

    if (beliefs.length === 0) {
      res.json({ data: { week: weekKey, challenges: [], beliefs_checked: 0 } });
      return;
    }

    if (force) {
      await db
        .delete(beliefChallenges)
        .where(
          and(
            eq(beliefChallenges.userId, userId),
            eq(beliefChallenges.weekKey, weekKey),
            isNull(beliefChallenges.response),
          ),
        );
    }

    // Skip beliefs already matched this week (the table is the cache). After a
    // forced clear, only responded challenges remain here.
    const existing = await db
      .select({ beliefId: beliefChallenges.beliefId })
      .from(beliefChallenges)
      .where(
        and(
          eq(beliefChallenges.userId, userId),
          eq(beliefChallenges.weekKey, weekKey),
        ),
      );
    const done = new Set(existing.map((r) => r.beliefId));
    // Cost guard: skip beliefs already checked this week — including clean ones
    // (a clean belief leaves no belief_challenges row to dedup on, so without
    // the marker it'd be re-sent to Haiku each run). A forced re-check bypasses
    // the marker; the `done` set (responded challenges) still wins.
    const todo = beliefs.filter(
      (b) => !done.has(b.id) && (force || b.lastCheckedWeekKey !== weekKey),
    );

    if (todo.length > 0) {
      const [profile] = await db
        .select({ sectors: userProfiles.sectors })
        .from(userProfiles)
        .where(eq(userProfiles.userId, userId))
        .limit(1);
      const userSectors = profile?.sectors ?? [];
      const since = new Date(Date.now() - RECENT_WINDOW_MS);

      // Candidates are fetched per belief, scoped to the belief's own sector (a
      // general/null-sector belief falls back to the reader's sectors). This
      // keeps a finance belief from being crowded out of a shared, mostly-AI
      // recent set — the diagnosis found recency-only retrieval dropped the
      // genuinely-relevant development. Retrieval is recency+sector, widened to
      // 30; embeddings proved near-orthogonal here, so Haiku does the relevance
      // ranking. (A keyword/FTS recall pass is a future refinement if 30/recent
      // ever misses.) Memoized on the sector scope (promise, not value) so
      // same-sector beliefs share one query without a fetch race.
      const candidateCache = new Map<string, Promise<BeliefMatchEvent[]>>();
      const candidatesForBelief = (
        beliefSector: string | null,
      ): Promise<BeliefMatchEvent[]> => {
        const scope = beliefSector ? [beliefSector] : userSectors;
        const key = scope.length > 0 ? [...scope].sort().join(",") : "*";
        const cached = candidateCache.get(key);
        if (cached) return cached;
        const recent = gte(events.publishedAt, since);
        const whereClause =
          scope.length > 0 ? and(recent, inArray(events.sector, scope)) : recent;
        const promise = db
          .select({
            id: events.id,
            headline: events.headline,
            genericCommentary: events.genericCommentary,
            whyItMatters: events.whyItMatters,
          })
          .from(events)
          .where(whereClause)
          .orderBy(desc(events.publishedAt))
          .limit(CANDIDATE_EVENT_LIMIT)
          .then((rows) =>
            rows.map((r) => ({
              id: r.id,
              headline: r.headline,
              gist: gistFor(r.genericCommentary, r.whyItMatters),
            })),
          );
        candidateCache.set(key, promise);
        return promise;
      };

      // Match each pending belief in parallel (bounded by MAX_BELIEFS_PER_RUN).
      // Each call fails closed, so one bad belief never sinks the run.
      await Promise.all(
        todo.map(async (b) => {
          const candidates = await candidatesForBelief(b.sector);
          if (candidates.length === 0) return;
          const verdict = await matchBeliefAgainstEvents({
            belief: { statement: b.statement, sector: b.sector },
            events: candidates,
          });
          if (!verdict) return;
          const ev = candidates[verdict.eventIndex - 1] ?? null;
          await db
            .insert(beliefChallenges)
            .values({
              beliefId: b.id,
              userId,
              eventId: ev?.id ?? null,
              weekKey,
              relevance: verdict.relevance,
              howToUpdate: verdict.read,
              dissent: verdict.dissent || null,
              sourceHeadline: ev?.headline ?? null,
            })
            .onConflictDoNothing();
        }),
      );

      // Mark every belief checked this run (challenged or clean) so re-runs
      // within the same ISO week skip them — the matcher is the only Haiku
      // cost on this path.
      await db
        .update(userBeliefs)
        .set({ lastCheckedWeekKey: weekKey, updatedAt: new Date() })
        .where(
          inArray(
            userBeliefs.id,
            todo.map((b) => b.id),
          ),
        );
    }

    const challenges = await loadWeekChallenges(userId, weekKey);
    res.json({ data: { week: weekKey, challenges, beliefs_checked: todo.length } });
  } catch (error) {
    next(error);
  }
}

export async function respondToChallenge(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const id = uuidSchema.safeParse(req.params.id);
    if (!id.success) throw new AppError("INVALID_QUERY", "Invalid challenge id", 400);
    const parsed = respondSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError("INVALID_BODY", "Invalid response", 400, parsed.error.flatten());
    }

    const [challenge] = await db
      .update(beliefChallenges)
      .set({
        response: parsed.data.response,
        responseNote: parsed.data.note?.trim() || null,
        respondedAt: new Date(),
      })
      .where(
        and(eq(beliefChallenges.id, id.data), eq(beliefChallenges.userId, userId)),
      )
      .returning();
    if (!challenge) throw new AppError("NOT_FOUND", "Challenge not found", 404);

    // North star = a belief that MOVED. 'revised' flips the belief's status and
    // logs belief_revised. 'strengthened' is the growth half (knowledge hardened
    // conviction) — logged as belief_strengthened, no status change.
    if (parsed.data.response === "revised") {
      await db
        .update(userBeliefs)
        .set({ status: "revised", updatedAt: new Date() })
        .where(
          and(
            eq(userBeliefs.id, challenge.beliefId),
            eq(userBeliefs.userId, userId),
          ),
        );
      await db.insert(productEvents).values({
        userId,
        eventType: "belief_revised",
        props: { beliefId: challenge.beliefId, challengeId: challenge.id },
      });
    } else if (parsed.data.response === "strengthened") {
      await db.insert(productEvents).values({
        userId,
        eventType: "belief_strengthened",
        props: { beliefId: challenge.beliefId, challengeId: challenge.id },
      });
    }

    res.json({ data: { challenge } });
  } catch (error) {
    next(error);
  }
}

// ---------- Belief evolution (partial B) ----------

// Every development that's touched a belief over its life (NOT week-scoped) —
// the matcher's verdicts in time order, with the reader's response + note. This
// is the data behind the "how your thinking evolved" timeline.
async function loadBeliefEvolution(
  userId: string,
  beliefId: string,
): Promise<unknown[]> {
  return db
    .select({
      id: beliefChallenges.id,
      belief_id: beliefChallenges.beliefId,
      relevance: beliefChallenges.relevance,
      how_to_update: beliefChallenges.howToUpdate,
      dissent: beliefChallenges.dissent,
      source_headline: beliefChallenges.sourceHeadline,
      event_id: beliefChallenges.eventId,
      response: beliefChallenges.response,
      response_note: beliefChallenges.responseNote,
      week_key: beliefChallenges.weekKey,
      created_at: beliefChallenges.createdAt,
      responded_at: beliefChallenges.respondedAt,
    })
    .from(beliefChallenges)
    .where(
      and(
        eq(beliefChallenges.userId, userId),
        eq(beliefChallenges.beliefId, beliefId),
      ),
    )
    .orderBy(desc(beliefChallenges.createdAt));
}

export async function getBeliefEvolution(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const id = uuidSchema.safeParse(req.params.id);
    if (!id.success) throw new AppError("INVALID_QUERY", "Invalid belief id", 400);
    const [belief] = await db
      .select({
        id: userBeliefs.id,
        statement: userBeliefs.statement,
        sector: userBeliefs.sector,
        status: userBeliefs.status,
        conviction: userBeliefs.conviction,
        horizon: userBeliefs.horizon,
        whatWouldBreakIt: userBeliefs.whatWouldBreakIt,
      })
      .from(userBeliefs)
      .where(and(eq(userBeliefs.id, id.data), eq(userBeliefs.userId, userId)))
      .limit(1);
    if (!belief) throw new AppError("NOT_FOUND", "Belief not found", 404);
    const evolution = await loadBeliefEvolution(userId, id.data);
    res.json({ data: { belief, evolution } });
  } catch (error) {
    next(error);
  }
}
