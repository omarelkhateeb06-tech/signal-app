import type { NextFunction, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  onboardingEvents,
  userProfiles,
  userTopicInterests,
  users,
} from "../db/schema";
import { AppError } from "../middleware/errorHandler";
import {
  GOALS,
  ROLES,
  SECTORS,
  SENIORITIES,
  isValidTopicForSector,
} from "../constants/onboardingTopics";
import { isValidDomain } from "../constants/domainOptions";

// Keep these in sync with the CHECK constraints in migrations 0008
// and 0013. If a literal is added/removed here, update the migrations
// AND the frontend LabeledOption list in lib/onboarding.ts.
const DEPTH_PREFERENCE_VALUES = ["accessible", "briefed", "technical"] as const;
const DIGEST_PREFERENCE_VALUES = ["morning", "evening", "none"] as const;

// IANA timezone max length — the longest identifier in tzdata is
// "America/Argentina/ComodRivadavia" at 33 chars. 64 gives headroom
// without admitting absurd inputs.
const TIMEZONE_MAX_LENGTH = 64;

// Max events per batched POST to /onboarding/events. Chosen high
// enough to comfortably hold one screen's worth of fine-grained
// interaction telemetry plus back-traversals, low enough to reject
// pathological payloads without reading past a reasonable limit.
const EVENTS_BATCH_MAX = 50;

// ---------- Zod schemas ----------

const topicSelectionSchema = z.object({
  sector: z.enum(SECTORS),
  topic: z.string().min(1).max(64),
});

const completeSchema = z.object({
  // Screen 1
  sectors: z
    .array(z.enum(SECTORS))
    .min(1, "Select at least one sector")
    .max(SECTORS.length),
  // Screen 2 — role + domain (Phase 12c expanded Screen 2 to include
  // domain). Domain validated via a refine() rather than z.enum so the
  // error message is stable across sector-specific option lists.
  role: z.enum(ROLES),
  domain: z
    .string()
    .min(1)
    .refine(isValidDomain, { message: "Domain is not a recognized value" }),
  // Screen 3
  seniority: z.enum(SENIORITIES),
  // Screen 4 (Phase 12c: depth now shows *after* goals — the step
  // number changed in the UI. The wire shape is unchanged — both
  // depth_preference and goals travel together on this request.)
  depth_preference: z.enum(DEPTH_PREFERENCE_VALUES),
  // Screen 5 — may be empty if the user skipped; the server fills it
  // with "all topics across selected sectors" when empty.
  topics: z.array(topicSelectionSchema).max(200),
  // Screen 6 — must be non-empty per schema; frontend passes
  // [DEFAULT_GOAL] when the user clicks Skip. Client never sends [].
  goals: z.array(z.enum(GOALS)).min(1).max(GOALS.length),
  // Screen 7
  digest_preference: z.enum(DIGEST_PREFERENCE_VALUES),
  timezone: z.string().min(1).max(TIMEZONE_MAX_LENGTH),
});

const eventSchema = z.object({
  event_type: z.string().min(1).max(64),
  screen_number: z.number().int().min(1).max(7).nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
  // Optional so the client can stamp the actual interaction time
  // even when the beacon is flushed later. If absent, the DB default
  // (now()) applies.
  occurred_at: z.string().datetime({ offset: true }).optional(),
});

const eventsBatchSchema = z.object({
  events: z.array(eventSchema).min(1).max(EVENTS_BATCH_MAX),
});

// ---------- Helpers ----------

function requireUserId(req: Request): string {
  if (!req.user) {
    throw new AppError("UNAUTHORIZED", "Not authenticated", 401);
  }
  return req.user.userId;
}

// Re-enforce the (sector, topic) pairing after Zod has validated each
// piece in isolation. Zod can prove `sector ∈ SECTORS` and `topic` is a
// reasonable string but can't prove the topic is valid for the given
// sector — that's a cross-field constraint. We reject mismatched
// pairs here so garbage never reaches the DB.
function validateTopicPairs(
  topics: { sector: string; topic: string }[],
): { sector: string; topic: string }[] {
  const invalid = topics.filter((t) => !isValidTopicForSector(t.sector, t.topic));
  if (invalid.length > 0) {
    throw new AppError("INVALID_INPUT", "One or more topics are not valid for their sector", 400, {
      invalid,
    });
  }
  // Dedupe by (sector, topic) so we never try to double-insert a row
  // and trip the composite PK.
  const seen = new Set<string>();
  return topics.filter((t) => {
    const key = `${t.sector}:${t.topic}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------- Endpoints ----------

/**
 * POST /api/v1/onboarding/events
 *
 * Batched telemetry write. Append-only; the endpoint never reads back.
 * Used for screen impressions, skip clicks, time-on-screen, etc.
 * Deliberately thin — validation + fan-out INSERT, no business logic.
 */
export async function postOnboardingEvents(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const input = eventsBatchSchema.parse(req.body);

    const rows = input.events.map((e) => ({
      userId,
      eventType: e.event_type,
      screenNumber: e.screen_number ?? null,
      metadata: e.metadata ?? {},
      // If the client supplied occurred_at, use it; else let the DB
      // default stamp now(). We set it unconditionally when provided
      // so late-flushed beacons still reflect the real interaction
      // time rather than the network arrival time.
      ...(e.occurred_at !== undefined ? { createdAt: new Date(e.occurred_at) } : {}),
    }));

    await db.insert(onboardingEvents).values(rows);

    res.status(202).json({ data: { accepted: rows.length } });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/v1/onboarding/complete
 *
 * Transactional commit of the full questionnaire. Upserts
 * user_profiles (or flips an existing unsubscribe-only row to
 * completed), replaces user_topic_interests wholesale, and emits an
 * `onboarding_completed` event. On failure anywhere in the tx, all
 * three writes roll back.
 */
export async function postOnboardingComplete(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);
    const input = completeSchema.parse(req.body);
    const validatedTopics = validateTopicPairs(input.topics);

    // Ensure the authenticated user still exists. An FK violation in
    // the tx below would roll us back anyway, but surfacing a clean
    // 404 here beats a 500 from a deferred constraint.
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) {
      throw new AppError("USER_NOT_FOUND", "User not found", 404);
    }

    const now = new Date();
    const profile = await db.transaction(async (tx) => {
      // Does a profile row already exist (e.g. from the unsubscribe
      // flow)? If so, flip it forward to completed; otherwise insert.
      const [existing] = await tx
        .select({ userId: userProfiles.userId })
        .from(userProfiles)
        .where(eq(userProfiles.userId, userId))
        .limit(1);

      const patch = {
        sectors: input.sectors,
        role: input.role,
        // Phase 12c — domain joins the completion payload. profile_version
        // is deliberately NOT touched here; it defaults to 1 on insert
        // and completion shouldn't bump it (bumps happen on post-
        // onboarding Settings mutations per Decision 7 of the 12c spec).
        domain: input.domain,
        seniority: input.seniority,
        depthPreference: input.depth_preference,
        goals: input.goals,
        digestPreference: input.digest_preference,
        timezone: input.timezone,
        completedAt: now,
        updatedAt: now,
      };

      let row;
      if (existing) {
        const [updated] = await tx
          .update(userProfiles)
          .set(patch)
          .where(eq(userProfiles.userId, userId))
          .returning();
        row = updated;
      } else {
        const [inserted] = await tx
          .insert(userProfiles)
          .values({ userId, ...patch })
          .returning();
        row = inserted;
      }
      if (!row) {
        throw new AppError(
          "PROFILE_WRITE_FAILED",
          "Failed to persist profile",
          500,
        );
      }

      // Replace the topic-interest set wholesale. Simpler than diffing
      // and safe because re-running onboarding is explicitly allowed
      // (and is how we recover from bad selections). The rowset is
      // bounded by the Zod max above.
      await tx.delete(userTopicInterests).where(eq(userTopicInterests.userId, userId));
      if (validatedTopics.length > 0) {
        await tx.insert(userTopicInterests).values(
          validatedTopics.map((t) => ({
            userId,
            sector: t.sector,
            topic: t.topic,
          })),
        );
      }

      // Emit the completion event inline so the audit trail is
      // atomic with the profile write.
      await tx.insert(onboardingEvents).values({
        userId,
        eventType: "onboarding_completed",
        screenNumber: 7,
        metadata: {
          sectors_count: input.sectors.length,
          topics_count: validatedTopics.length,
          depth_preference: input.depth_preference,
          digest_preference: input.digest_preference,
        },
      });

      return row;
    });

    res.json({ data: { profile, completed_at: profile.completedAt } });
  } catch (error) {
    next(error);
  }
}
