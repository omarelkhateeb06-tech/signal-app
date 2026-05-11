// Phase 12f — rules-based feed ranking v1. Tunable constants used by
// both the SQL ORDER BY expression in `storyController.getFeed` and
// the parallel TS implementation in `calculateEffectiveScore` (which
// exists so the formula can be unit-tested independently of the DB).
//
// Formula (mirror of the SQL expression):
//   effective_score
//     = quality_score
//     + ln(1 + sources_attached_count) * W1
//     - age_hours * W2
//     + freshness_bonus
//     - edgar_penalty
//
// `quality_score` (1–10) is per-source editorial weighting seeded on
// `ingestion_sources.quality_score` in migration 0014.
// `sources_attached_count` is the number of *alternate* event_sources
// rows for the event (= total event_sources − 1). A solo event scores
// ln(1+0)=0 amplification; a cluster of 3 sources scores ln(3)*W1.

/**
 * W1 — cluster amplification weight. Multiplied by ln(1 + alternates).
 */
export const W1 = 2.0;

/**
 * W2 — recency decay per hour. With age_hours * W2 subtracted, W2=0.15
 * yields roughly a 12-hour half-life relative to the cluster + quality
 * base. Tune during the soak.
 */
export const W2 = 0.15;

/**
 * Freshness bonus applied to events whose primary source has
 * quality_score ≥ FRESHNESS_QUALITY_THRESHOLD and that were published
 * within the last FRESHNESS_WINDOW_HOURS. Intended to surface first-
 * party labs (Anthropic / OpenAI / DeepMind / etc.), primary regulator
 * filings (Fed / BIS / SEC primary), and top analysts (SemiAnalysis,
 * Money Stuff) when they ship something material.
 */
export const FRESHNESS_BONUS = 3.0;
export const FRESHNESS_WINDOW_HOURS = 6;
export const FRESHNESS_QUALITY_THRESHOLD = 9;

/**
 * EDGAR penalty applied to events whose sole event_sources row points
 * at one of the EDGAR slugs AND whose body enrichment never produced
 * usable body_text. Caps raw EDGAR filings below editorial content
 * until issue #86 (machine-format title/excerpt) is fixed.
 */
export const EDGAR_PENALTY = 4.0;

/**
 * Slugs whose presence as the *sole* source of an event qualifies the
 * event for the EDGAR penalty. Matches ingestion_sources.slug values
 * seeded by migration 0014.
 */
export const EDGAR_SOURCE_SLUGS = ["sec-edgar-full", "sec-edgar-semis"] as const;

/**
 * Top-N cap on ranked events returned by the feed. Configurable via
 * env var FEED_MAX_STORIES; falls back to 100. Read once at module
 * load — server restart picks up env changes.
 */
export const FEED_MAX_STORIES: number = (() => {
  const raw = process.env.FEED_MAX_STORIES;
  if (!raw) return 100;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 100;
})();
