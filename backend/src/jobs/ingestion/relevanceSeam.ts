// Phase 12e.4 — concrete `runRelevanceGate` seam implementation.
//
// Pure of `enrichmentJob.ts`: this module owns the LLM call + JSON
// parse + retry policy. The orchestration body (in enrichmentJob)
// owns the DB writes (status / sector / llm_judgment_raw). Same
// separation as the 12e.3 heuristicSeam.
//
// Sequence:
//   1. Load candidate (raw_title, body_text, source).
//   2. Build prompt (G7/G8 — title + truncated body).
//   3. Call Haiku with `{` prefill (RELEVANCE_GATE_ASSISTANT_PREFILL).
//   4. Map any client-level failure to a RelevanceReason; no retry.
//   5. On client success: parse + Zod-validate JSON.
//      - relevant=true with valid sector → success.
//      - relevant=false → success (sector forced null upstream).
//      - relevant=true with missing/invalid sector → trigger retry (G5).
//      - JSON parse / shape mismatch → trigger retry (G4).
//   6. Retry path: same prompt, stricter prefill, single attempt.
//      Persistent failure → LLM_PARSE_ERROR.
//
// The seam returns a structured result (does NOT throw). The
// orchestration body persists it.

import { eq } from "drizzle-orm";
import { z } from "zod";

import { db as defaultDb } from "../../db";
import { ingestionCandidates, ingestionSources } from "../../db/schema";
import {
  buildRelevanceGatePrompt,
  RELEVANCE_GATE_ASSISTANT_PREFILL,
  RELEVANCE_GATE_ASSISTANT_PREFILL_STRICT,
} from "../../llm/prompts/ingestion/relevanceGate";
import {
  callHaikuForRelevance,
  type HaikuRelevanceCallOptions,
} from "../../services/haikuRelevanceClient";
import { COMMENTARY_MODEL } from "../../services/haikuCommentaryClient";
import type { HaikuResult, HaikuFailureReason } from "../../services/haikuCommentaryClient";

export const VALID_SECTORS = ["ai", "finance", "semiconductors"] as const;
export type Sector = (typeof VALID_SECTORS)[number];

const RelevanceJudgmentSchema = z.object({
  relevant: z.boolean(),
  sector: z.enum(VALID_SECTORS).optional(),
  reason: z.string(),
});

export type RelevanceJudgment = z.infer<typeof RelevanceJudgmentSchema>;

// Stable rejection-class strings written to ingestion_candidates.status_reason
// when the LLM gate rejects. Matches the convention used by 12e.3
// HEURISTIC_REASONS — controlled vocabulary, queryable.
export const RELEVANCE_REASONS = {
  LLM_REJECTED: "llm_rejected",
  LLM_PARSE_ERROR: "llm_parse_error",
  LLM_RATE_LIMITED: "llm_rate_limited",
  LLM_TIMEOUT: "llm_timeout",
  LLM_NO_API_KEY: "llm_no_api_key",
  LLM_EMPTY: "llm_empty",
  LLM_API_ERROR: "llm_api_error",
} as const;

export type RelevanceReason =
  (typeof RELEVANCE_REASONS)[keyof typeof RELEVANCE_REASONS];

export interface RelevanceSeamRaw {
  model: string;
  promptText: string;
  responseText: string;
  latencyMs: number;
  attempts: number;
}

export interface RelevanceSeamResult {
  relevant: boolean;
  sector?: Sector;
  reason?: string;
  // Populated when relevant=false; specific rejection class for
  // status_reason. Undefined on success.
  rejectionReason?: RelevanceReason;
  // Populated when at least one Haiku call returned successfully.
  // Stored verbatim into ingestion_candidates.llm_judgment_raw for
  // the G6 audit surface (queryable post-hoc).
  raw?: RelevanceSeamRaw;
}

export interface RelevanceSeamDeps {
  db?: typeof defaultDb;
  callHaiku?: typeof callHaikuForRelevance;
  now?: () => Date;
}

interface CandidateRow {
  id: string;
  rawTitle: string | null;
  bodyText: string | null;
}

async function loadCandidate(
  db: typeof defaultDb,
  candidateId: string,
): Promise<CandidateRow | null> {
  const rows = await db
    .select({
      id: ingestionCandidates.id,
      rawTitle: ingestionCandidates.rawTitle,
      bodyText: ingestionCandidates.bodyText,
    })
    .from(ingestionCandidates)
    .leftJoin(
      ingestionSources,
      eq(ingestionSources.id, ingestionCandidates.ingestionSourceId),
    )
    .where(eq(ingestionCandidates.id, candidateId))
    .limit(1);
  return rows[0] ?? null;
}

function mapHaikuFailure(
  failure: HaikuFailureReason,
  detail: string | undefined,
): RelevanceReason {
  switch (failure) {
    case "timeout":
      return RELEVANCE_REASONS.LLM_TIMEOUT;
    case "no_api_key":
      return RELEVANCE_REASONS.LLM_NO_API_KEY;
    case "empty":
      return RELEVANCE_REASONS.LLM_EMPTY;
    case "api_error": {
      // The underlying client doesn't distinguish 429 from other API
      // errors. Heuristic: detail string contains "429" or "rate" →
      // upgrade to LLM_RATE_LIMITED so soak observability + 12e.5c
      // dead-letter routing can distinguish.
      const d = (detail ?? "").toLowerCase();
      if (d.includes("429") || d.includes("rate")) {
        return RELEVANCE_REASONS.LLM_RATE_LIMITED;
      }
      return RELEVANCE_REASONS.LLM_API_ERROR;
    }
  }
}

function tryParseJudgment(text: string): RelevanceJudgment | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const result = RelevanceJudgmentSchema.safeParse(parsed);
  if (!result.success) return null;
  // G5: relevant=true requires a valid sector. Missing-sector on a
  // relevant=true verdict is treated as a parse failure and triggers
  // the retry path.
  if (result.data.relevant && !result.data.sector) {
    return null;
  }
  return result.data;
}

function logSuccess(
  candidateId: string,
  judgment: RelevanceJudgment,
  latencyMs: number,
  attempts: number,
): void {
  // eslint-disable-next-line no-console
  console.log(
    `[ingestion-llm-relevance] candidate=${candidateId} relevant=${judgment.relevant} sector=${judgment.sector ?? "none"} latency_ms=${latencyMs} attempts=${attempts}`,
  );
}

function logRejection(
  candidateId: string,
  rejectionReason: RelevanceReason,
  attempts: number,
): void {
  // eslint-disable-next-line no-console
  console.warn(
    `[ingestion-llm-relevance] candidate=${candidateId} rejected reason=${rejectionReason} attempts=${attempts}`,
  );
}

async function callOnce(
  prompt: string,
  callHaiku: typeof callHaikuForRelevance,
  opts: HaikuRelevanceCallOptions,
  now: () => Date,
): Promise<{ result: HaikuResult; latencyMs: number }> {
  const t0 = now().getTime();
  const result = await callHaiku(prompt, opts);
  const latencyMs = now().getTime() - t0;
  return { result, latencyMs };
}

export async function runRelevanceSeam(
  candidateId: string,
  deps: RelevanceSeamDeps = {},
): Promise<RelevanceSeamResult> {
  const db = deps.db ?? defaultDb;
  const callHaiku = deps.callHaiku ?? callHaikuForRelevance;
  const now = deps.now ?? (() => new Date());

  const candidate = await loadCandidate(db, candidateId);
  if (!candidate) {
    // Defensive: shouldn't happen via the normal poll → enqueue → CLI
    // pipeline, but produce a structured rejection rather than throw.
    logRejection(candidateId, RELEVANCE_REASONS.LLM_REJECTED, 0);
    return {
      relevant: false,
      rejectionReason: RELEVANCE_REASONS.LLM_REJECTED,
      reason: "candidate not found",
    };
  }

  const promptText = buildRelevanceGatePrompt({
    title: candidate.rawTitle ?? "",
    bodyText: candidate.bodyText ?? "",
  });

  // ---- Attempt 1 ----
  const a1 = await callOnce(
    promptText,
    callHaiku,
    { assistantPrefill: RELEVANCE_GATE_ASSISTANT_PREFILL },
    now,
  );

  if (!a1.result.ok) {
    const rejectionReason = mapHaikuFailure(
      a1.result.reason,
      a1.result.detail,
    );
    logRejection(candidateId, rejectionReason, 1);
    return { relevant: false, rejectionReason };
  }

  const a1Judgment = tryParseJudgment(a1.result.text);
  if (a1Judgment) {
    const sector = a1Judgment.relevant ? a1Judgment.sector : undefined;
    const raw: RelevanceSeamRaw = {
      model: COMMENTARY_MODEL,
      promptText,
      responseText: a1.result.text,
      latencyMs: a1.latencyMs,
      attempts: 1,
    };
    if (a1Judgment.relevant) {
      logSuccess(candidateId, a1Judgment, a1.latencyMs, 1);
      return {
        relevant: true,
        sector,
        reason: a1Judgment.reason,
        raw,
      };
    }
    logSuccess(candidateId, a1Judgment, a1.latencyMs, 1);
    return {
      relevant: false,
      rejectionReason: RELEVANCE_REASONS.LLM_REJECTED,
      reason: a1Judgment.reason,
      raw,
    };
  }

  // ---- Attempt 2 (parse-retry) ----
  const a2 = await callOnce(
    promptText,
    callHaiku,
    { assistantPrefill: RELEVANCE_GATE_ASSISTANT_PREFILL_STRICT },
    now,
  );

  // First attempt's text we keep so the persisted raw reflects the
  // bytes we actually saw (stricter-prefill retry only matters when
  // we fall through; on a2 success we record both attempts.)
  const totalLatency = a1.latencyMs + a2.latencyMs;

  if (!a2.result.ok) {
    // Combined attempts: first parsed-empty/garbled, second client-fail.
    // Record the parse error class — it's the more diagnostic signal.
    const raw: RelevanceSeamRaw = {
      model: COMMENTARY_MODEL,
      promptText,
      responseText: a1.result.text, // first response (the one that failed parse)
      latencyMs: totalLatency,
      attempts: 2,
    };
    logRejection(candidateId, RELEVANCE_REASONS.LLM_PARSE_ERROR, 2);
    return {
      relevant: false,
      rejectionReason: RELEVANCE_REASONS.LLM_PARSE_ERROR,
      raw,
    };
  }

  const a2Judgment = tryParseJudgment(a2.result.text);
  if (!a2Judgment) {
    // Both attempts failed parse → terminal LLM_PARSE_ERROR.
    const raw: RelevanceSeamRaw = {
      model: COMMENTARY_MODEL,
      promptText,
      responseText: a2.result.text, // second response (most recent)
      latencyMs: totalLatency,
      attempts: 2,
    };
    logRejection(candidateId, RELEVANCE_REASONS.LLM_PARSE_ERROR, 2);
    return {
      relevant: false,
      rejectionReason: RELEVANCE_REASONS.LLM_PARSE_ERROR,
      raw,
    };
  }

  // Retry succeeded.
  const raw: RelevanceSeamRaw = {
    model: COMMENTARY_MODEL,
    promptText,
    responseText: a2.result.text,
    latencyMs: totalLatency,
    attempts: 2,
  };
  if (a2Judgment.relevant) {
    logSuccess(candidateId, a2Judgment, totalLatency, 2);
    return {
      relevant: true,
      sector: a2Judgment.sector,
      reason: a2Judgment.reason,
      raw,
    };
  }
  logSuccess(candidateId, a2Judgment, totalLatency, 2);
  return {
    relevant: false,
    rejectionReason: RELEVANCE_REASONS.LLM_REJECTED,
    reason: a2Judgment.reason,
    raw,
  };
}
