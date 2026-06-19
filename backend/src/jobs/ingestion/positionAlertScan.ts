// Phase A⑤ (Tripwire) — continuous, event-driven position monitor.
//
// The redesign's core change: the belief matcher no longer waits for a weekly
// manual "Check now". When the enrichment chain publishes a NEW event, the
// worker tail calls this to check that one development against readers' active
// positions (sector-matched). A material hit (contradicts/pressures) becomes
// an alert + an email; the radar classes (supports/watch) become a silent
// on-screen alert. The reader's screen stays empty until something genuinely
// moves a position.
//
// Cost control. The naive shape is one Haiku call per (event × position),
// which grows with the user base. Two rails keep it bounded:
//   1. SECTOR scope — only positions in the event's sector (general/null
//      positions match any sector) are considered.
//   2. A hard per-event Haiku cap (POSITION_SCAN_MAX_MATCHES). This bounds
//      spend at cap × events/day, INDEPENDENT of user count.
// Deliberately NO lexical keyword prefilter: it would drop genuinely-relevant
// developments that share no surface words with a position (e.g. "sub-quadratic
// models" refuting "transformer scaling wins") — false negatives on the exact
// thing this product exists to catch. At launch scale the cap is rarely hit, so
// every sector-matched position is judged by Haiku (full recall); when the cap
// does bite at scale, the weekly "Check now" path remains the thorough backstop.
//
// Fails CLOSED and never throws — a matcher/email/DB problem must not break the
// enrichment worker.

import { and, desc, eq, isNull, or } from "drizzle-orm";

import { db as defaultDb } from "../../db";
import { beliefChallenges, events, userBeliefs, users } from "../../db/schema";
import {
  isoWeekKey,
  matchBeliefAgainstEvents,
} from "../../services/beliefMatchService";
import { notifyBeliefAlert } from "../../services/beliefAlertService";
import { captureIngestionStageFailure } from "../../lib/sentryHelpers";

// Hard cap on matcher (Haiku) calls per event — the real spend rail. Bounds
// cost at cap × events/day regardless of user count; the query fetches at most
// this many positions. At launch scale a sector rarely has this many active
// positions, so every one is judged (full recall).
const POSITION_SCAN_MAX_MATCHES = Number(
  process.env.POSITION_SCAN_MAX_MATCHES ?? 25,
);

// Gist length handed to the matcher — mirrors the weekly path's GIST cap.
const GIST_MAX_CHARS = 360;

// generic_commentary preferred, why_it_matters fallback, trimmed to the gist
// cap on a word boundary. Exported for unit testing.
export function eventGist(
  genericCommentary: string | null,
  whyItMatters: string | null,
): string {
  const raw =
    (genericCommentary && genericCommentary.trim()) ||
    (whyItMatters && whyItMatters.trim()) ||
    "";
  if (raw.length <= GIST_MAX_CHARS) return raw;
  const head = raw.slice(0, GIST_MAX_CHARS);
  const lastSpace = head.lastIndexOf(" ");
  return lastSpace > GIST_MAX_CHARS / 2 ? head.slice(0, lastSpace) : head;
}

export interface PositionScanResult {
  checked: number; // positions handed to the matcher
  alerts: number; // new belief_challenges rows created
  emailed: number; // material alerts emailed
}

export interface PositionScanDeps {
  db?: typeof defaultDb;
  matchBelief?: typeof matchBeliefAgainstEvents;
  notify?: typeof notifyBeliefAlert;
  captureFailure?: typeof captureIngestionStageFailure;
}

const ZERO: PositionScanResult = { checked: 0, alerts: 0, emailed: 0 };

export async function scanEventForPositionAlerts(
  eventId: string,
  deps: PositionScanDeps = {},
): Promise<PositionScanResult> {
  // The matcher is a Haiku call — skip the whole scan when the key is unset
  // (mirrors nativeGeneration / the relevance gate's opt-out).
  if (!process.env.ANTHROPIC_API_KEY) return ZERO;

  const db = deps.db ?? defaultDb;
  const matchBelief = deps.matchBelief ?? matchBeliefAgainstEvents;
  const notify = deps.notify ?? notifyBeliefAlert;
  const captureFailure = deps.captureFailure ?? captureIngestionStageFailure;

  try {
    const [event] = await db
      .select({
        id: events.id,
        headline: events.headline,
        sector: events.sector,
        genericCommentary: events.genericCommentary,
        whyItMatters: events.whyItMatters,
      })
      .from(events)
      .where(eq(events.id, eventId))
      .limit(1);
    if (!event) return ZERO;

    const gist = eventGist(event.genericCommentary, event.whyItMatters);
    const weekKey = isoWeekKey(new Date());

    // Active positions whose sector matches the event (a general/null-sector
    // position is watched against every sector). Joined to users for the alert
    // recipient. Newest first so the per-event cap, if it bites, favors the
    // reader's most recent positions.
    const positions = await db
      .select({
        id: userBeliefs.id,
        userId: userBeliefs.userId,
        statement: userBeliefs.statement,
        sector: userBeliefs.sector,
        whatWouldBreakIt: userBeliefs.whatWouldBreakIt,
        email: users.email,
        name: users.name,
      })
      .from(userBeliefs)
      .innerJoin(users, eq(users.id, userBeliefs.userId))
      .where(
        and(
          eq(userBeliefs.status, "active"),
          or(eq(userBeliefs.sector, event.sector), isNull(userBeliefs.sector)),
        ),
      )
      .orderBy(desc(userBeliefs.createdAt))
      .limit(POSITION_SCAN_MAX_MATCHES);

    let checked = 0;
    let alerts = 0;
    let emailed = 0;

    for (const p of positions) {
      checked++;
      const verdict = await matchBelief({
        belief: {
          statement: p.statement,
          sector: p.sector,
          whatWouldBreakIt: p.whatWouldBreakIt,
        },
        events: [{ id: event.id, headline: event.headline, gist }],
      });
      if (!verdict) continue;

      // Create the alert. The unique index (belief, week, event) +
      // onConflictDoNothing dedups a re-processed event; .returning() comes
      // back empty when the row already existed, so we only notify on a
      // genuinely new alert.
      const [row] = await db
        .insert(beliefChallenges)
        .values({
          beliefId: p.id,
          userId: p.userId,
          eventId: event.id,
          weekKey,
          relevance: verdict.relevance,
          howToUpdate: verdict.read,
          dissent: verdict.dissent || null,
          sourceHeadline: event.headline,
        })
        .onConflictDoNothing()
        .returning({ id: beliefChallenges.id });
      if (!row) continue;
      alerts++;

      // Email only material alerts; supports/watch stay on the in-app radar.
      if (
        verdict.relevance === "contradicts" ||
        verdict.relevance === "pressures"
      ) {
        const res = await notify({
          challengeId: row.id,
          userId: p.userId,
          toEmail: p.email,
          toName: p.name,
          positionStatement: p.statement,
          relevance: verdict.relevance,
          howToUpdate: verdict.read,
          dissent: verdict.dissent || null,
          sourceHeadline: event.headline,
        });
        if (res.emailed) emailed++;
      }
    }

    if (alerts > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `[position-alert-scan] event=${eventId} checked=${checked} alerts=${alerts} emailed=${emailed}`,
      );
    }
    return { checked, alerts, emailed };
  } catch (err) {
    // Soft-fail: a matcher/email/DB problem must never break the enrichment
    // worker. Captured for observability (candidate_id carries the event id).
    captureFailure({
      stage: "position_scan",
      candidateId: eventId,
      sourceSlug: null,
      rejectionReason: "position_scan_failed",
      err,
    });
    return ZERO;
  }
}
