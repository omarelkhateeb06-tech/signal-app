// Phase 12f — TS mirror of the SQL ranking expression used in
// `storyController.getFeed`. Exists so the formula can be exercised
// in unit tests without standing up Postgres + mockDb plumbing for
// every weight tweak. The SQL expression in the controller is the
// canonical implementation; this function must stay in lockstep with
// it. When you change one, change the other and update
// `tests/feed/ranking.test.ts`.

import {
  EDGAR_PENALTY,
  FRESHNESS_BONUS,
  FRESHNESS_QUALITY_THRESHOLD,
  FRESHNESS_WINDOW_HOURS,
  W1,
  W2,
  W3,
} from "./rankingConstants";

export interface EffectiveScoreInputs {
  /** Per-source editorial weighting from ingestion_sources.quality_score (1–10). */
  qualityScore: number;
  /**
   * Count of *alternate* event_sources rows attached to the event (i.e.
   * total event_sources − 1 for the primary). Solo events pass 0.
   */
  sourcesAttachedCount: number;
  /** Age of the event in hours since published_at (or created_at). */
  ageHours: number;
  /**
   * True iff the event has exactly one event_sources row AND that
   * source's slug is in EDGAR_SOURCE_SLUGS. Pre-computed by the SQL
   * subquery in the controller; tests pass it directly.
   */
  isEdgarSoleSource: boolean;
  /**
   * True iff any ingestion_candidate with resolved_event_id = event.id
   * has non-empty body_text. False = body enrichment never landed
   * usable text, which is what gates the EDGAR penalty.
   */
  bodyTextPresent: boolean;
  /**
   * Absolute count of user_saves rows pointing at this event. Optional —
   * omitted / undefined is treated as 0 saves (the graceful default:
   * missing save data must not error or penalize, per the 12-series
   * decision). Log-scaled by W3 so an outlier count doesn't dominate.
   */
  saveCount?: number;
}

export function calculateEffectiveScore(input: EffectiveScoreInputs): number {
  const clusterAmplification = W1 * Math.log(1 + input.sourcesAttachedCount);
  const saveSignal = W3 * Math.log(1 + (input.saveCount ?? 0));
  const recencyDecay = W2 * input.ageHours;
  const freshnessBonus =
    input.qualityScore >= FRESHNESS_QUALITY_THRESHOLD &&
    input.ageHours <= FRESHNESS_WINDOW_HOURS
      ? FRESHNESS_BONUS
      : 0;
  const edgarPenalty =
    input.isEdgarSoleSource && !input.bodyTextPresent ? EDGAR_PENALTY : 0;

  return (
    input.qualityScore +
    clusterAmplification +
    saveSignal -
    recencyDecay +
    freshnessBonus -
    edgarPenalty
  );
}
