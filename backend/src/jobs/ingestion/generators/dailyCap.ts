// Phase 12n.4 — global daily volume cap for native-post generation.
//
// Each generator has its own per-run cap (2–3 posts), but nothing bounds the
// TOTAL across all five generators. If every generator qualifies in the same
// window the theoretical max is 3+2+2+2+2 = 11 posts/day — over the 10/day
// target. This module enforces a single global ceiling, checked at generation
// time against a DB count of today's native events.
//
// Mechanism (locked): DB count, not a Redis counter. Before a generator's
// authoring run, count events WHERE source_type='native' AND created_at >=
// start-of-today-UTC. The count is the source of truth, so separate CLI
// invocations across the day compose naturally — invocation N sees the events
// invocations 1..N-1 already wrote. The enforcement point is the
// runNativeGeneration.ts CLI, NOT nativeEnrichmentJob: the cap applies per CLI
// run, never per individual candidate's enrichment.
//
// "Today" is the UTC calendar day (midnight–midnight), consistent with the
// system's other daily resets (paywall counters, digest window).

// The global ceiling: at most this many native posts per UTC calendar day,
// across every generator combined.
export const NATIVE_DAILY_CAP = 10;

// The plan a single generator run should follow given the day's usage so far.
export interface CapPlan {
  // Native events already written today (UTC). The cap is measured against this.
  used: number;
  // How many more native posts may be persisted today (cap - used, floored 0).
  remaining: number;
  // Whether the budget is spent — when true the generator should not run.
  exhausted: boolean;
}

// Pure cap arithmetic. Separated from the DB read so it is trivially testable
// and the CLI can reason about the plan without I/O.
export function planDailyCap(used: number, cap: number): CapPlan {
  const remaining = Math.max(0, cap - used);
  return { used, remaining, exhausted: remaining <= 0 };
}

// Truncate a generator's produced candidates to the remaining daily budget.
// The generator's own per-run cap still applies inside generate(); this is the
// CLI-level ceiling that keeps the LAST generator of the day from overshooting
// the global cap. Generator internals are untouched — the cap is a post-filter.
export function applyDailyCap<T>(candidates: T[], remaining: number): T[] {
  if (remaining <= 0) return [];
  return candidates.slice(0, remaining);
}

export interface DailyCapDeps {
  // Count of native events written today (UTC). Injectable for tests;
  // production reads the events table.
  countTodayNativeEvents?: (now: Date) => Promise<number>;
}

// Count today's (UTC) native events. Fail-OPEN: on any DB error, report 0 used
// — the cap is a ceiling, not a gate, and a count-query failure should degrade
// to "let the run proceed" (at most the generator's own per-run cap slips
// through) rather than halt native generation entirely. Matches the codebase's
// fail-open posture for non-critical Redis/DB guardrails.
async function defaultCountTodayNativeEvents(now: Date): Promise<number> {
  try {
    const [{ db }, schema, drizzle] = await Promise.all([
      import("../../../db"),
      import("../../../db/schema"),
      import("drizzle-orm"),
    ]);
    const { events } = schema;
    const { and, eq, gte, sql } = drizzle;
    const startOfDayUtc = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(events)
      .where(
        and(
          eq(events.sourceType, "native"),
          gte(events.createdAt, startOfDayUtc),
        ),
      );
    return Number(rows[0]?.n ?? 0);
  } catch {
    return 0;
  }
}

// Read today's native-event count and return the cap plan. The CLI calls this
// before running a generator: if `exhausted`, skip the generator (no LLM call);
// otherwise cap the persisted candidates to `remaining`.
export async function checkDailyCap(
  now: Date,
  cap: number = NATIVE_DAILY_CAP,
  deps: DailyCapDeps = {},
): Promise<CapPlan> {
  const count = deps.countTodayNativeEvents ?? defaultCountTodayNativeEvents;
  const used = await count(now);
  return planDailyCap(used, cap);
}
