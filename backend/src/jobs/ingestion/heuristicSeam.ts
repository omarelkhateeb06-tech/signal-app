// Concrete `runHeuristic` seam implementation for the enrichment
// orchestration. Pure of `enrichmentJob` so it can be unit-tested
// independently with a mocked DB and a mocked body fetcher.
//
// Sequence:
//   1. Load candidate row (joined with source for UA config).
//   2. Pre-fetch checks (cheap) — summary+title empty, recency, noise.
//   3. Fetch body via injected fetcher.
//   4. Post-fetch check — body length floor.
//   5. Pass → return { pass: true, body: { text, truncated } }.
//
// Side effects: NONE. The seam is read-only at the DB. The orchestration
// body in `enrichmentJob.ts` writes the resulting status / body_text /
// status_reason. This keeps "run heuristic" testable without DB writes.

import { eq } from "drizzle-orm";

import { db as defaultDb } from "../../db";
import { ingestionCandidates, ingestionSources } from "../../db/schema";
import {
  HEURISTIC_REASONS,
  type HeuristicReason,
  isNonArticleUrl,
  isRecent,
  isSummaryAndTitleEmpty,
  matchesNoisePattern,
  meetsLengthFloor,
  noiseCategoryToReason,
} from "./heuristics";
import {
  DEFAULT_BODY_USER_AGENT,
  fetchAndExtractBody,
  type BodyExtractionResult,
} from "./bodyExtractor";

export type HeuristicSeamResult = {
  pass: boolean;
  reason?: HeuristicReason;
  body?: { text: string; truncated: boolean };
};

export interface HeuristicSeamDeps {
  // Drizzle DB instance — defaults to the production singleton, override
  // with mockDb in tests.
  db?: typeof defaultDb;
  // Injectable body fetcher — defaults to the real fetchAndExtractBody.
  fetchBody?: typeof fetchAndExtractBody;
  // Clock injection for recency tests.
  now?: () => Date;
}

interface CandidateRow {
  id: string;
  url: string;
  rawTitle: string | null;
  rawSummary: string | null;
  rawPublishedAt: Date | null;
  sourceUserAgent: string | null;
}

async function loadCandidate(
  db: typeof defaultDb,
  candidateId: string,
): Promise<CandidateRow | null> {
  const rows = await db
    .select({
      id: ingestionCandidates.id,
      url: ingestionCandidates.url,
      rawTitle: ingestionCandidates.rawTitle,
      rawSummary: ingestionCandidates.rawSummary,
      rawPublishedAt: ingestionCandidates.rawPublishedAt,
      sourceConfig: ingestionSources.config,
    })
    .from(ingestionCandidates)
    .innerJoin(
      ingestionSources,
      eq(ingestionSources.id, ingestionCandidates.ingestionSourceId),
    )
    .where(eq(ingestionCandidates.id, candidateId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const cfg = row.sourceConfig ?? {};
  const ua = typeof cfg.userAgent === "string" && cfg.userAgent.length > 0 ? cfg.userAgent : null;
  return {
    id: row.id,
    url: row.url,
    rawTitle: row.rawTitle,
    rawSummary: row.rawSummary,
    rawPublishedAt: row.rawPublishedAt,
    sourceUserAgent: ua,
  };
}

export async function runHeuristicSeam(
  candidateId: string,
  deps: HeuristicSeamDeps = {},
): Promise<HeuristicSeamResult> {
  const db = deps.db ?? defaultDb;
  const fetchBody = deps.fetchBody ?? fetchAndExtractBody;
  const now = deps.now ?? (() => new Date());

  const candidate = await loadCandidate(db, candidateId);
  if (!candidate) {
    // Caller treats a missing row as a hard failure upstream — surface
    // it as a body_fetch_failed reason since we can't make a real
    // pass/reject call without the row. (Practically, the orchestration
    // body should never call us with a stale ID.)
    return { pass: false, reason: HEURISTIC_REASONS.BODY_FETCH_FAILED };
  }

  // 1. Empty-summary-and-title.
  if (isSummaryAndTitleEmpty(candidate.rawTitle, candidate.rawSummary)) {
    return { pass: false, reason: HEURISTIC_REASONS.SUMMARY_AND_TITLE_EMPTY };
  }

  // 2. Recency.
  if (!isRecent(candidate.rawPublishedAt, now())) {
    return { pass: false, reason: HEURISTIC_REASONS.RECENCY_TOO_OLD };
  }

  // 3. Noise patterns.
  const noise = matchesNoisePattern(candidate.rawTitle, candidate.rawSummary);
  if (noise.match && noise.category) {
    return { pass: false, reason: noiseCategoryToReason(noise.category) };
  }

  // 3b. Non-article URL shapes (12e.x). Drop video pages etc. before
  // we waste a body fetch on a player surface. These rejections share
  // the heuristic_filtered terminal status; the reason
  // `filtered_video_url` flags them as expected drops, distinct from
  // body_*/noise_* failure / noise classes in soak metrics.
  if (isNonArticleUrl(candidate.url)) {
    return { pass: false, reason: HEURISTIC_REASONS.FILTERED_VIDEO_URL };
  }

  // 4. Body fetch.
  const userAgent = candidate.sourceUserAgent ?? DEFAULT_BODY_USER_AGENT;
  const fetchResult: BodyExtractionResult = await fetchBody(candidate.url, { userAgent });
  if (!fetchResult.success) {
    return { pass: false, reason: fetchResult.reason };
  }

  // 5. Length floor (post-extraction).
  if (!meetsLengthFloor(fetchResult.text)) {
    return { pass: false, reason: HEURISTIC_REASONS.BODY_TOO_SHORT };
  }

  return {
    pass: true,
    body: { text: fetchResult.text, truncated: fetchResult.truncated },
  };
}
