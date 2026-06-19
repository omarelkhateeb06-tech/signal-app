// Belief maintenance — the missionary pivot's API.
//
// CRUD over the reader's working assumptions, plus the "Reconsider" ritual:
// runChallenges asks Haiku, per active belief, whether any of the week's top
// developments materially challenges it, and persists the verdict to
// belief_challenges (which doubles as the per-week cache). respondToChallenge
// records the reader's verdict — 'revised' is the north star (a logged
// belief_revised product_event = an assumption updated).
//
// Cost discipline: runChallenges is the only Haiku path here. It skips
// beliefs already challenged this week, caps beliefs per run, and matches in
// parallel (each call carries the service's own 10s timeout / fail-closed).

import type { NextFunction, Request, Response } from "express";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
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
const VALID_SECTORS = ["ai", "finance", "semiconductors"] as const;
const CANDIDATE_EVENT_LIMIT = 10;
const MAX_BELIEFS_PER_RUN = 10;
const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function requireUserId(req: Request): string {
  if (!req.user) throw new AppError("UNAUTHORIZED", "Not authenticated", 401);
  return req.user.userId;
}

// One-line gist for the matcher prompt — generic_commentary (role-neutral)
// preferred, why_it_matters fallback; first sentence, capped.
function gistFor(genericCommentary: string | null, whyItMatters: string): string {
  const source = (genericCommentary?.trim() || whyItMatters).trim();
  const breakIdx = source.search(/[.!?\n]/);
  const slice = breakIdx > 0 ? source.slice(0, breakIdx + 1) : source;
  return slice.slice(0, 220).trim();
}

const createSchema = z.object({
  statement: z.string().trim().min(8).max(MAX_BELIEF_LENGTH),
  sector: z.enum(VALID_SECTORS).nullish(),
});

const updateSchema = z
  .object({
    statement: z.string().trim().min(8).max(MAX_BELIEF_LENGTH).optional(),
    status: z.enum(["active", "revised", "archived"]).optional(),
  })
  .refine((d) => d.statement !== undefined || d.status !== undefined, {
    message: "Nothing to update",
  });

const respondSchema = z.object({
  response: z.enum(["revised", "held", "dismissed"]),
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

    // Skip beliefs already matched this week (the table is the cache).
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
    // Cost guard: also skip beliefs already checked this week — including ones
    // that produced no challenge (a clean belief leaves no belief_challenges
    // row to dedup on, so without the marker it'd be re-sent to Haiku each run).
    const todo = beliefs.filter(
      (b) => !done.has(b.id) && b.lastCheckedWeekKey !== weekKey,
    );

    if (todo.length > 0) {
      // Candidate developments: recent, in the reader's sectors.
      const [profile] = await db
        .select({ sectors: userProfiles.sectors })
        .from(userProfiles)
        .where(eq(userProfiles.userId, userId))
        .limit(1);
      const sectors = profile?.sectors ?? [];
      const since = new Date(Date.now() - RECENT_WINDOW_MS);
      const recent = gte(events.publishedAt, since);
      const whereClause =
        sectors.length > 0 ? and(recent, inArray(events.sector, sectors)) : recent;

      const candidateRows = await db
        .select({
          id: events.id,
          headline: events.headline,
          genericCommentary: events.genericCommentary,
          whyItMatters: events.whyItMatters,
        })
        .from(events)
        .where(whereClause)
        .orderBy(desc(events.publishedAt))
        .limit(CANDIDATE_EVENT_LIMIT);

      const candidates: BeliefMatchEvent[] = candidateRows.map((r) => ({
        id: r.id,
        headline: r.headline,
        gist: gistFor(r.genericCommentary, r.whyItMatters),
      }));

      // Match each pending belief in parallel (bounded by MAX_BELIEFS_PER_RUN).
      // Each call fails closed, so one bad belief never sinks the run.
      await Promise.all(
        todo.map(async (b) => {
          const verdict = await matchBeliefAgainstEvents({
            belief: { statement: b.statement, sector: b.sector },
            events: candidates,
          });
          if (!verdict) return;
          const ev =
            verdict.eventIndex != null ? candidates[verdict.eventIndex - 1] : null;
          await db
            .insert(beliefChallenges)
            .values({
              beliefId: b.id,
              userId,
              eventId: ev?.id ?? null,
              weekKey,
              howToUpdate: verdict.howToUpdate,
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
      .set({ response: parsed.data.response, respondedAt: new Date() })
      .where(
        and(eq(beliefChallenges.id, id.data), eq(beliefChallenges.userId, userId)),
      )
      .returning();
    if (!challenge) throw new AppError("NOT_FOUND", "Challenge not found", 404);

    // 'revised' is the north star: the reader updated a belief because SIGNAL
    // flagged a contradiction. Mark the belief revised + log the event.
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
    }

    res.json({ data: { challenge } });
  } catch (error) {
    next(error);
  }
}
