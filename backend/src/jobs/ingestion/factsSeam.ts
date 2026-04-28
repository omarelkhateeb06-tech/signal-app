// Phase 12e.5a — concrete `runFactsSeam` implementation.
//
// Pure of `enrichmentJob.ts`: this module owns the LLM call + JSON
// parse + Zod-validation + retry policy. The orchestration body (in
// enrichmentJob) owns the DB writes (facts / facts_extracted_at /
// facts_extraction_raw / status advance). Same separation as the 12e.4
// relevanceSeam.
//
// Sequence:
//   1. Load candidate (raw_title, body_text, sector). Sector must be in
//      VALID_SECTORS — defensive guard, since the 12e.4 seam writes one
//      of the three values; out-of-vocabulary sector → terminal-reject
//      mapped to FACTS_PARSE_ERROR (the upstream contract was violated).
//   2. Build prompt (title + sector hint + truncated body).
//   3. Call Haiku with `{` prefill (FACTS_PROMPT_ASSISTANT_PREFILL).
//   4. Map any client-level failure to a FactsReason; no retry.
//   5. On client success: parse + Zod-validate JSON.
//      - shape valid (5–8 facts, each {text, category}) → success.
//      - JSON parse / shape mismatch → trigger retry (single attempt
//        with stricter prefill `{"facts":`).
//   6. Retry path: same prompt, stricter prefill, single attempt.
//      Persistent failure → terminal FACTS_PARSE_ERROR.
//
// Idempotency note: the seam itself does NOT short-circuit on already-
// extracted candidates. The CLI / future worker query filter handles
// gating at the row-selection layer
// (`status='llm_relevant' AND facts_extracted_at IS NULL`).
//
// The seam returns a structured result (does NOT throw). The
// orchestration body persists it.

import { eq } from "drizzle-orm";
import { z } from "zod";

import { db as defaultDb } from "../../db";
import { ingestionCandidates } from "../../db/schema";
import {
  buildFactExtractionPrompt,
  FACTS_PROMPT_ASSISTANT_PREFILL,
  FACTS_PROMPT_ASSISTANT_PREFILL_STRICT,
} from "../../llm/prompts/ingestion/factExtraction";
import {
  callHaikuForFacts,
  type HaikuFactsCallOptions,
} from "../../services/haikuFactsClient";
import { COMMENTARY_MODEL } from "../../services/haikuCommentaryClient";
import type { HaikuResult, HaikuFailureReason } from "../../services/haikuCommentaryClient";
import { VALID_SECTORS, type Sector } from "./relevanceSeam";

// ---- Output schema (Zod) ----

// Per-fact bounds:
//  - text: 10–500 chars. Floor filters trivial fragments; ceiling is a
//    runaway-paragraph guard well above the 1-sentence target.
//  - category: 1–64 chars. Floor accepts any non-empty label; ceiling
//    rejects prose-in-the-category-field failures.
// .strict() rejects extra per-fact fields (e.g. `confidence`,
// `source_span`) so the persisted blob doesn't silently absorb model
// drift. Mirrors the 12a WhyItMattersTemplateSchema discipline.
export const ExtractedFactSchema = z.object({
  text: z.string().min(10).max(500),
  category: z.string().min(1).max(64),
}).strict();

export const ExtractedFactsSchema = z.object({
  facts: z.array(ExtractedFactSchema).min(5).max(8),
}).strict();

export type ExtractedFact = z.infer<typeof ExtractedFactSchema>;
export type ExtractedFacts = z.infer<typeof ExtractedFactsSchema>;

// ---- Rejection-reason vocabulary ----

// Stable rejection-class strings written to ingestion_candidates.status_reason
// when the facts stage rejects. Mirrors 12e.4's RELEVANCE_REASONS
// taxonomy minus the `_REJECTED` slot — facts have no LLM-side
// rejection path (the model can't say "I refuse to extract facts from
// this article" the way it can say "this isn't relevant").
export const FACTS_REASONS = {
  FACTS_PARSE_ERROR: "facts_parse_error",
  FACTS_RATE_LIMITED: "facts_rate_limited",
  FACTS_TIMEOUT: "facts_timeout",
  FACTS_NO_API_KEY: "facts_no_api_key",
  FACTS_EMPTY: "facts_empty",
  FACTS_API_ERROR: "facts_api_error",
} as const;

export type FactsReason = (typeof FACTS_REASONS)[keyof typeof FACTS_REASONS];

// ---- Seam result types ----

export interface FactsSeamRaw {
  model: string;
  promptText: string;
  responseText: string;
  latencyMs: number;
  attempts: number;
}

export interface FactsSeamResult {
  ok: boolean;
  facts?: ExtractedFacts;
  // Populated when ok=false; specific rejection class for
  // status_reason. Undefined on success.
  rejectionReason?: FactsReason;
  // Populated when at least one Haiku call returned successfully.
  // Stored verbatim into ingestion_candidates.facts_extraction_raw for
  // the audit surface.
  raw?: FactsSeamRaw;
}

export interface FactsSeamDeps {
  db?: typeof defaultDb;
  callHaiku?: typeof callHaikuForFacts;
  now?: () => Date;
}

interface CandidateRow {
  id: string;
  rawTitle: string | null;
  bodyText: string | null;
  sector: string | null;
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
      sector: ingestionCandidates.sector,
    })
    .from(ingestionCandidates)
    .where(eq(ingestionCandidates.id, candidateId))
    .limit(1);
  return rows[0] ?? null;
}

function mapHaikuFailure(
  failure: HaikuFailureReason,
  detail: string | undefined,
): FactsReason {
  switch (failure) {
    case "timeout":
      return FACTS_REASONS.FACTS_TIMEOUT;
    case "no_api_key":
      return FACTS_REASONS.FACTS_NO_API_KEY;
    case "empty":
      return FACTS_REASONS.FACTS_EMPTY;
    case "api_error": {
      // The underlying client doesn't distinguish 429 from other API
      // errors. Heuristic: detail string contains "429" or "rate" →
      // upgrade to FACTS_RATE_LIMITED so soak observability + 12e.5c
      // dead-letter routing can distinguish.
      const d = (detail ?? "").toLowerCase();
      if (d.includes("429") || d.includes("rate")) {
        return FACTS_REASONS.FACTS_RATE_LIMITED;
      }
      return FACTS_REASONS.FACTS_API_ERROR;
    }
  }
}

function tryParseFacts(text: string): ExtractedFacts | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const result = ExtractedFactsSchema.safeParse(parsed);
  if (!result.success) return null;
  return result.data;
}

function isValidSector(value: string | null): value is Sector {
  return value !== null && (VALID_SECTORS as readonly string[]).includes(value);
}

function logSuccess(
  candidateId: string,
  factCount: number,
  latencyMs: number,
  attempts: number,
): void {
  // eslint-disable-next-line no-console
  console.log(
    `[ingestion-facts] candidate=${candidateId} ok=true fact_count=${factCount} latency_ms=${latencyMs} attempts=${attempts}`,
  );
}

function logRejection(
  candidateId: string,
  rejectionReason: FactsReason,
  attempts: number,
): void {
  // eslint-disable-next-line no-console
  console.warn(
    `[ingestion-facts] candidate=${candidateId} rejected reason=${rejectionReason} attempts=${attempts}`,
  );
}

async function callOnce(
  prompt: string,
  callHaiku: typeof callHaikuForFacts,
  opts: HaikuFactsCallOptions,
  now: () => Date,
): Promise<{ result: HaikuResult; latencyMs: number }> {
  const t0 = now().getTime();
  const result = await callHaiku(prompt, opts);
  const latencyMs = now().getTime() - t0;
  return { result, latencyMs };
}

export async function runFactsSeam(
  candidateId: string,
  deps: FactsSeamDeps = {},
): Promise<FactsSeamResult> {
  const db = deps.db ?? defaultDb;
  const callHaiku = deps.callHaiku ?? callHaikuForFacts;
  const now = deps.now ?? (() => new Date());

  const candidate = await loadCandidate(db, candidateId);
  if (!candidate) {
    // Defensive: shouldn't happen via the normal poll → enqueue → CLI
    // pipeline, but produce a structured rejection rather than throw.
    logRejection(candidateId, FACTS_REASONS.FACTS_PARSE_ERROR, 0);
    return {
      ok: false,
      rejectionReason: FACTS_REASONS.FACTS_PARSE_ERROR,
    };
  }

  if (!isValidSector(candidate.sector)) {
    // Upstream contract was violated — the 12e.4 seam should have set
    // sector to one of VALID_SECTORS before advancing status to
    // llm_relevant. Treat as a parse-class terminal-reject.
    logRejection(candidateId, FACTS_REASONS.FACTS_PARSE_ERROR, 0);
    return {
      ok: false,
      rejectionReason: FACTS_REASONS.FACTS_PARSE_ERROR,
    };
  }

  const promptText = buildFactExtractionPrompt({
    title: candidate.rawTitle ?? "",
    bodyText: candidate.bodyText ?? "",
    sector: candidate.sector,
  });

  // ---- Attempt 1 ----
  const a1 = await callOnce(
    promptText,
    callHaiku,
    { assistantPrefill: FACTS_PROMPT_ASSISTANT_PREFILL },
    now,
  );

  if (!a1.result.ok) {
    const rejectionReason = mapHaikuFailure(
      a1.result.reason,
      a1.result.detail,
    );
    logRejection(candidateId, rejectionReason, 1);
    return { ok: false, rejectionReason };
  }

  const a1Facts = tryParseFacts(a1.result.text);
  if (a1Facts) {
    const raw: FactsSeamRaw = {
      model: COMMENTARY_MODEL,
      promptText,
      responseText: a1.result.text,
      latencyMs: a1.latencyMs,
      attempts: 1,
    };
    logSuccess(candidateId, a1Facts.facts.length, a1.latencyMs, 1);
    return { ok: true, facts: a1Facts, raw };
  }

  // ---- Attempt 2 (parse-retry with stricter prefill) ----
  const a2 = await callOnce(
    promptText,
    callHaiku,
    { assistantPrefill: FACTS_PROMPT_ASSISTANT_PREFILL_STRICT },
    now,
  );

  const totalLatency = a1.latencyMs + a2.latencyMs;

  if (!a2.result.ok) {
    // First parsed-empty/garbled, second client-fail. Record the parse
    // error class — it's the more diagnostic signal. Persist the first
    // attempt's response bytes (the parse-failing one) for audit.
    const raw: FactsSeamRaw = {
      model: COMMENTARY_MODEL,
      promptText,
      responseText: a1.result.text,
      latencyMs: totalLatency,
      attempts: 2,
    };
    logRejection(candidateId, FACTS_REASONS.FACTS_PARSE_ERROR, 2);
    return {
      ok: false,
      rejectionReason: FACTS_REASONS.FACTS_PARSE_ERROR,
      raw,
    };
  }

  const a2Facts = tryParseFacts(a2.result.text);
  if (!a2Facts) {
    // Both attempts failed parse → terminal FACTS_PARSE_ERROR.
    const raw: FactsSeamRaw = {
      model: COMMENTARY_MODEL,
      promptText,
      responseText: a2.result.text,
      latencyMs: totalLatency,
      attempts: 2,
    };
    logRejection(candidateId, FACTS_REASONS.FACTS_PARSE_ERROR, 2);
    return {
      ok: false,
      rejectionReason: FACTS_REASONS.FACTS_PARSE_ERROR,
      raw,
    };
  }

  // Retry succeeded.
  const raw: FactsSeamRaw = {
    model: COMMENTARY_MODEL,
    promptText,
    responseText: a2.result.text,
    latencyMs: totalLatency,
    attempts: 2,
  };
  logSuccess(candidateId, a2Facts.facts.length, totalLatency, 2);
  return { ok: true, facts: a2Facts, raw };
}
