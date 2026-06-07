// Phase 12f — rules-based feed ranking v1. Tunable constants used by
// both the SQL ORDER BY expression in `storyController.getFeed` and
// the parallel TS implementation in `calculateEffectiveScore` (which
// exists so the formula can be unit-tested independently of the DB).
//
// Formula (mirror of the SQL expression):
//   effective_score
//     = quality_score
//     + ln(1 + sources_attached_count) * W1
//     + ln(1 + save_count) * W3
//     - age_hours * W2
//     + freshness_bonus
//     - edgar_penalty
//
// `quality_score` (1–10) is per-source editorial weighting seeded on
// `ingestion_sources.quality_score` in migration 0014.
// `sources_attached_count` is the number of *alternate* event_sources
// rows for the event (= total event_sources − 1). A solo event scores
// ln(1+0)=0 amplification; a cluster of 3 sources scores ln(3)*W1.
// `save_count` is the absolute number of user_saves rows pointing at the
// event. Log-scaled like cluster amplification so a high-save outlier
// lifts the event without dominating the score; an event with zero saves
// scores ln(1+0)=0 (the graceful default — no save data → no penalty).

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
 * W3 — save-signal weight. Multiplied by ln(1 + save_count), mirroring
 * the cluster-amplification shape so an outlier save count is normalized
 * rather than allowed to dominate. Sized below W1: at 10 saves the lift
 * is ~1.5*ln(11)≈3.6, at 50 saves ~5.9, at 1000 saves only ~10.4 — a
 * meaningful but bounded nudge. Save *count* (not rate) is the signal in
 * this stage; save rate waits on reliable view tracking. Tune during the
 * soak alongside W1/W2.
 */
export const W3 = 1.5;

/**
 * W4 — engagement-signal weight (Phase 12o.5 / 3D). Multiplied by
 * `ln(1 + engagement_count)`, where engagement_count is the number of *intent*
 * engagement events (click_through + share) recorded against the event. Same
 * log shape as the save signal and sized below W3, so a handful of early
 * interactions barely move the score. `LN(1+0)=0` means the term vanishes with
 * no data — it ships safely pre-beta and auto-activates as engagement accrues.
 * Tune during the soak once real distributions exist.
 */
export const W4 = 1.0;

/**
 * Per-content-type freshness-decay multipliers (Phase 12R / 4B). The recency
 * penalty is `W2 * multiplier * age_hours`. Evergreen SIGNAL-native synthesis
 * decays half as fast as breaking news; SEC filings stay relevant for a few
 * days; everything else (ingested news) keeps the tuned default of 1.0. This
 * only *slows* evergreen/filing content — the news ranking W2 was tuned for is
 * unchanged.
 */
export const FRESHNESS_DECAY_NATIVE = 0.5;
export const FRESHNESS_DECAY_FILING = 0.75;

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
