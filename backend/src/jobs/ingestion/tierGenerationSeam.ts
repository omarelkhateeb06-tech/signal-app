// Phase 12e.5b — concrete `runTierGenerationSeam` implementation.
//
// One seam parameterized by tier (accessible / briefed / technical).
// Pure of `enrichmentJob.ts`: this module owns the LLM call + JSON
// parse + Zod-validation + retry policy for a single tier. The
// orchestration body (CLI in 12e.5b, worker in 12e.5c) owns the DB
// writes (jsonb_set under tier_outputs.<tier>, tier_outputs_raw audit
// blob, status advance once all three keys present).
//
// Sequence (per tier):
//   1. Load candidate (raw_title, body_text, sector, facts, status).
//      Preconditions: status ∈ {facts_extracted, tier_generated}, facts
//      non-null, body_text non-null, sector ∈ VALID_SECTORS. Any miss
//      → terminal-reject mapped to TIER_PARSE_ERROR (the upstream
//      contract was violated).
//   2. Build prompt via the tier-specific builder. Inputs: title, body,
//      sector, facts (parsed from JSONB).
//   3. Call Haiku with `{` prefill (TIER_*_ASSISTANT_PREFILL).
//   4. Map any client-level failure to a TierReason; no retry.
//   5. On client success: parse + Zod-validate {thesis, support}.
//      - shape valid → success.
//      - JSON parse / shape mismatch → trigger retry (single attempt
//        with stricter prefill `{"thesis":`).
//   6. Retry path: same prompt, stricter prefill, single attempt.
//      Persistent failure → terminal TIER_PARSE_ERROR.
//
// Idempotency note: the seam itself does NOT short-circuit on already-
// completed tiers. The orchestrator (CLI) owns per-tier presence checks
// against `tier_outputs->>'<tier>'` before invoking the seam, mirroring
// the 12e.5a row-selection-layer pattern.
//
// The seam returns a structured result (does NOT throw). The
// orchestration body persists it.

import { eq } from "drizzle-orm";
import { z } from "zod";

import { db as defaultDb } from "../../db";
import { ingestionCandidates } from "../../db/schema";
import {
  buildTierAccessiblePrompt,
  TIER_ACCESSIBLE_ASSISTANT_PREFILL,
  TIER_ACCESSIBLE_ASSISTANT_PREFILL_STRICT,
} from "../../llm/prompts/ingestion/tierAccessible";
import {
  buildTierBriefedPrompt,
  TIER_BRIEFED_ASSISTANT_PREFILL,
  TIER_BRIEFED_ASSISTANT_PREFILL_STRICT,
} from "../../llm/prompts/ingestion/tierBriefed";
import {
  buildTierTechnicalPrompt,
  TIER_TECHNICAL_ASSISTANT_PREFILL,
  TIER_TECHNICAL_ASSISTANT_PREFILL_STRICT,
} from "../../llm/prompts/ingestion/tierTechnical";
import {
  callHaikuForTier,
  type HaikuTierCallOptions,
  type TierName,
} from "../../services/haikuTierClient";
import { COMMENTARY_MODEL } from "../../services/haikuCommentaryClient";
import type { HaikuResult, HaikuFailureReason } from "../../services/haikuCommentaryClient";
import { VALID_SECTORS, type Sector } from "./relevanceSeam";

// ---- Output schema (Zod) ----

// Per-field bounds:
//  - thesis: 10–800 chars. Floor filters trivial fragments. Ceiling
//    accommodates technical-tier ~40-word target with headroom; all
//    three tiers' theses fit comfortably.
//  - support: 10–2000 chars. Floor matches thesis. Ceiling
//    accommodates technical-tier ~130-word target with headroom; all
//    three tiers' support fits.
// .strict() rejects extra top-level fields so the persisted blob does
// not silently absorb model drift. Mirrors the 12e.5a
// ExtractedFactsSchema discipline.
export const TierOutputSchema = z.object({
  thesis: z.string().trim().min(10).max(800),
  support: z.string().trim().min(10).max(2000),
}).strict();

export type TierOutput = z.infer<typeof TierOutputSchema>;

// ---- Rejection-reason vocabulary ----

// Stable rejection-class strings written to ingestion_candidates.status_reason
// when a tier-generation call rejects. Mirrors 12e.5a's FACTS_REASONS
// taxonomy — same six failure classes apply.
export const TIER_REASONS = {
  TIER_PARSE_ERROR: "tier_parse_error",
  TIER_RATE_LIMITED: "tier_rate_limited",
  TIER_TIMEOUT: "tier_timeout",
  TIER_NO_API_KEY: "tier_no_api_key",
  TIER_EMPTY: "tier_empty",
  TIER_API_ERROR: "tier_api_error",
} as const;

export type TierReason = (typeof TIER_REASONS)[keyof typeof TIER_REASONS];

// ---- Seam result types ----

export interface TierSeamRaw {
  model: string;
  promptText: string;
  responseText: string;
  latencyMs: number;
  attempts: number;
}

export interface TierSeamSuccess {
  ok: true;
  tier: TierName;
  output: TierOutput;
  attempts: number;
  latencyMs: number;
  rawResponse: string;
  raw: TierSeamRaw;
}

export interface TierSeamFailure {
  ok: false;
  tier: TierName;
  rejectionReason: TierReason;
  attempts: number;
  rawResponse?: string;
  raw?: TierSeamRaw;
}

export type TierSeamResult = TierSeamSuccess | TierSeamFailure;

export interface TierSeamDeps {
  db?: typeof defaultDb;
  haikuClient?: typeof callHaikuForTier;
  now?: () => Date;
}

interface CandidateRow {
  id: string;
  rawTitle: string | null;
  bodyText: string | null;
  sector: string | null;
  facts: Record<string, unknown> | null;
  status: string;
}

const FactInputShape = z.object({
  text: z.string(),
  category: z.string(),
});
const FactsInputShape = z.object({
  facts: z.array(FactInputShape),
});

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
      facts: ingestionCandidates.facts,
      status: ingestionCandidates.status,
    })
    .from(ingestionCandidates)
    .where(eq(ingestionCandidates.id, candidateId))
    .limit(1);
  return (rows[0] as CandidateRow | undefined) ?? null;
}

function mapHaikuFailure(
  failure: HaikuFailureReason,
  detail: string | undefined,
): TierReason {
  switch (failure) {
    case "timeout":
      return TIER_REASONS.TIER_TIMEOUT;
    case "no_api_key":
      return TIER_REASONS.TIER_NO_API_KEY;
    case "empty":
      return TIER_REASONS.TIER_EMPTY;
    case "api_error": {
      // The underlying client doesn't distinguish 429 from other API
      // errors. Heuristic: detail string contains "429" or "rate" →
      // upgrade to TIER_RATE_LIMITED so soak observability + 12e.5c
      // dead-letter routing can distinguish.
      const d = (detail ?? "").toLowerCase();
      if (d.includes("429") || d.includes("rate")) {
        return TIER_REASONS.TIER_RATE_LIMITED;
      }
      return TIER_REASONS.TIER_API_ERROR;
    }
  }
}

function tryParseTierOutput(text: string): TierOutput | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const result = TierOutputSchema.safeParse(parsed);
  if (!result.success) return null;
  return result.data;
}

function isValidSector(value: string | null): value is Sector {
  return value !== null && (VALID_SECTORS as readonly string[]).includes(value);
}

function isPreconditionStatus(status: string): boolean {
  return status === "facts_extracted" || status === "tier_generated";
}

function parseFactsForPrompt(
  rawFacts: Record<string, unknown> | null,
): Array<{ text: string; category: string }> | null {
  if (!rawFacts) return null;
  const result = FactsInputShape.safeParse(rawFacts);
  if (!result.success) return null;
  return result.data.facts;
}

function buildPromptForTier(
  tier: TierName,
  inputs: {
    title: string;
    bodyText: string;
    sector: Sector;
    facts: Array<{ text: string; category: string }>;
  },
): string {
  switch (tier) {
    case "accessible":
      return buildTierAccessiblePrompt(inputs);
    case "briefed":
      return buildTierBriefedPrompt(inputs);
    case "technical":
      return buildTierTechnicalPrompt(inputs);
  }
}

function prefillsForTier(tier: TierName): { primary: string; strict: string } {
  switch (tier) {
    case "accessible":
      return {
        primary: TIER_ACCESSIBLE_ASSISTANT_PREFILL,
        strict: TIER_ACCESSIBLE_ASSISTANT_PREFILL_STRICT,
      };
    case "briefed":
      return {
        primary: TIER_BRIEFED_ASSISTANT_PREFILL,
        strict: TIER_BRIEFED_ASSISTANT_PREFILL_STRICT,
      };
    case "technical":
      return {
        primary: TIER_TECHNICAL_ASSISTANT_PREFILL,
        strict: TIER_TECHNICAL_ASSISTANT_PREFILL_STRICT,
      };
  }
}

function logSuccess(
  candidateId: string,
  tier: TierName,
  latencyMs: number,
  attempts: number,
): void {
  // eslint-disable-next-line no-console
  console.log(
    `[ingestion-tier] candidate=${candidateId} tier=${tier} ok=true latency_ms=${latencyMs} attempts=${attempts}`,
  );
}

function logRejection(
  candidateId: string,
  tier: TierName,
  rejectionReason: TierReason,
  attempts: number,
): void {
  // eslint-disable-next-line no-console
  console.warn(
    `[ingestion-tier] candidate=${candidateId} tier=${tier} rejected reason=${rejectionReason} attempts=${attempts}`,
  );
}

async function callOnce(
  prompt: string,
  tier: TierName,
  callHaiku: typeof callHaikuForTier,
  opts: HaikuTierCallOptions,
  now: () => Date,
): Promise<{ result: HaikuResult; latencyMs: number }> {
  const t0 = now().getTime();
  const result = await callHaiku(prompt, tier, opts);
  const latencyMs = now().getTime() - t0;
  return { result, latencyMs };
}

export async function runTierGenerationSeam(
  candidateId: string,
  tier: TierName,
  deps: TierSeamDeps = {},
): Promise<TierSeamResult> {
  const db = deps.db ?? defaultDb;
  const callHaiku = deps.haikuClient ?? callHaikuForTier;
  const now = deps.now ?? (() => new Date());

  const candidate = await loadCandidate(db, candidateId);
  if (!candidate) {
    // Defensive: shouldn't happen via the normal pipeline, but produce
    // a structured rejection rather than throw.
    logRejection(candidateId, tier, TIER_REASONS.TIER_PARSE_ERROR, 0);
    return {
      ok: false,
      tier,
      rejectionReason: TIER_REASONS.TIER_PARSE_ERROR,
      attempts: 0,
    };
  }

  if (!isPreconditionStatus(candidate.status)) {
    // Upstream contract was violated — only candidates that have
    // completed fact extraction are eligible for tier generation.
    logRejection(candidateId, tier, TIER_REASONS.TIER_PARSE_ERROR, 0);
    return {
      ok: false,
      tier,
      rejectionReason: TIER_REASONS.TIER_PARSE_ERROR,
      attempts: 0,
    };
  }

  if (!candidate.bodyText) {
    logRejection(candidateId, tier, TIER_REASONS.TIER_PARSE_ERROR, 0);
    return {
      ok: false,
      tier,
      rejectionReason: TIER_REASONS.TIER_PARSE_ERROR,
      attempts: 0,
    };
  }

  if (!isValidSector(candidate.sector)) {
    logRejection(candidateId, tier, TIER_REASONS.TIER_PARSE_ERROR, 0);
    return {
      ok: false,
      tier,
      rejectionReason: TIER_REASONS.TIER_PARSE_ERROR,
      attempts: 0,
    };
  }

  const facts = parseFactsForPrompt(candidate.facts);
  if (!facts) {
    logRejection(candidateId, tier, TIER_REASONS.TIER_PARSE_ERROR, 0);
    return {
      ok: false,
      tier,
      rejectionReason: TIER_REASONS.TIER_PARSE_ERROR,
      attempts: 0,
    };
  }

  const promptText = buildPromptForTier(tier, {
    title: candidate.rawTitle ?? "",
    bodyText: candidate.bodyText,
    sector: candidate.sector,
    facts,
  });

  const prefills = prefillsForTier(tier);

  // ---- Attempt 1 ----
  const a1 = await callOnce(
    promptText,
    tier,
    callHaiku,
    { prefill: prefills.primary },
    now,
  );

  if (!a1.result.ok) {
    const rejectionReason = mapHaikuFailure(
      a1.result.reason,
      a1.result.detail,
    );
    logRejection(candidateId, tier, rejectionReason, 1);
    return {
      ok: false,
      tier,
      rejectionReason,
      attempts: 1,
    };
  }

  const a1Output = tryParseTierOutput(a1.result.text);
  if (a1Output) {
    const raw: TierSeamRaw = {
      model: COMMENTARY_MODEL,
      promptText,
      responseText: a1.result.text,
      latencyMs: a1.latencyMs,
      attempts: 1,
    };
    logSuccess(candidateId, tier, a1.latencyMs, 1);
    return {
      ok: true,
      tier,
      output: a1Output,
      attempts: 1,
      latencyMs: a1.latencyMs,
      rawResponse: a1.result.text,
      raw,
    };
  }

  // ---- Attempt 2 (parse-retry with stricter prefill) ----
  const a2 = await callOnce(
    promptText,
    tier,
    callHaiku,
    { prefill: prefills.strict },
    now,
  );

  const totalLatency = a1.latencyMs + a2.latencyMs;

  if (!a2.result.ok) {
    // First parsed-empty/garbled, second client-fail. Record the parse
    // error class — it's the more diagnostic signal. Persist the first
    // attempt's response bytes (the parse-failing one) for audit.
    const raw: TierSeamRaw = {
      model: COMMENTARY_MODEL,
      promptText,
      responseText: a1.result.text,
      latencyMs: totalLatency,
      attempts: 2,
    };
    logRejection(candidateId, tier, TIER_REASONS.TIER_PARSE_ERROR, 2);
    return {
      ok: false,
      tier,
      rejectionReason: TIER_REASONS.TIER_PARSE_ERROR,
      attempts: 2,
      rawResponse: a1.result.text,
      raw,
    };
  }

  const a2Output = tryParseTierOutput(a2.result.text);
  if (!a2Output) {
    // Both attempts failed parse → terminal TIER_PARSE_ERROR.
    const raw: TierSeamRaw = {
      model: COMMENTARY_MODEL,
      promptText,
      responseText: a2.result.text,
      latencyMs: totalLatency,
      attempts: 2,
    };
    logRejection(candidateId, tier, TIER_REASONS.TIER_PARSE_ERROR, 2);
    return {
      ok: false,
      tier,
      rejectionReason: TIER_REASONS.TIER_PARSE_ERROR,
      attempts: 2,
      rawResponse: a2.result.text,
      raw,
    };
  }

  // Retry succeeded.
  const raw: TierSeamRaw = {
    model: COMMENTARY_MODEL,
    promptText,
    responseText: a2.result.text,
    latencyMs: totalLatency,
    attempts: 2,
  };
  logSuccess(candidateId, tier, totalLatency, 2);
  return {
    ok: true,
    tier,
    output: a2Output,
    attempts: 2,
    latencyMs: totalLatency,
    rawResponse: a2.result.text,
    raw,
  };
}
