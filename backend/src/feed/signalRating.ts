// SIGNAL rating — the 0–100 credibility/quality score shown per story (§1,
// a named V1 differentiator). It blends three signals already attached to an
// event: the primary source's editorial quality, its source tier (priority
// 1 = lab/SEC/regulator … 4 = community), and how many independent sources
// corroborate the event.
//
// The SQL expression in `storyController.eventSignalRatingExpr` is the
// canonical implementation (it runs in the feed/detail/search/related
// queries); this pure function is its mirror, kept in lockstep so the formula
// is unit-testable without standing up Postgres. Change one → change the other
// → update tests/feed/signalRating.test.ts.

export interface SignalRatingInputs {
  /** ingestion_sources.quality_score of the primary source (1–10). */
  quality: number;
  /** ingestion_sources.priority of the primary source (1 = highest tier … 4). */
  priority: number;
  /** Count of *alternate* sources (total event_sources − 1) — corroboration. */
  alternates: number;
}

// Quality (1–10) carries the bulk of the score: 1 → 7, 10 → 70.
export const QUALITY_WEIGHT = 7;
// Tier bonus = (4 − priority) × step → tier 1 = +24, tier 2 = +16, tier 3 = +8,
// tier 4 = +0. A lab/SEC primary reads as more credible than a community post.
export const TIER_BONUS_STEP = 8;
// Each corroborating source adds this, capped — a widely-covered event reads as
// more credible, but a single outlet-wall shouldn't dominate the score.
export const CORROBORATION_STEP = 4;
export const CORROBORATION_CAP = 12;

function clampPriority(priority: number): number {
  if (priority < 1) return 1;
  if (priority > 4) return 4;
  return priority;
}

/** Returns an integer SIGNAL rating in [0, 100]. */
export function calculateSignalRating(input: SignalRatingInputs): number {
  const qualityTerm = Math.max(0, input.quality) * QUALITY_WEIGHT;
  const tierBonus = (4 - clampPriority(input.priority)) * TIER_BONUS_STEP;
  const corroboration = Math.min(
    CORROBORATION_CAP,
    Math.max(0, input.alternates) * CORROBORATION_STEP,
  );
  const raw = qualityTerm + tierBonus + corroboration;
  return Math.max(0, Math.min(100, Math.round(raw)));
}
