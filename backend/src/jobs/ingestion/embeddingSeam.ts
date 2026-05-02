// Phase 12e.6a — embedding seam. Computes a 1536-dim embedding for a
// candidate's title + body via OpenAI text-embedding-3-small. Returns a
// discriminated-union result; the orchestrator persists the embedding
// to ingestion_candidates and feeds it into the cluster-check seam.
//
// Soft-fail philosophy mirrors the Haiku seams: any API error becomes a
// structured rejection rather than an exception, so the enrichment chain
// keeps moving (facts + tiers still run; cluster check just returns
// matched=false because there is no embedding to compare).

import OpenAI from "openai";
import { eq } from "drizzle-orm";

import { db as defaultDb } from "../../db";
import { ingestionCandidates } from "../../db/schema";

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;

export type EmbeddingFailureReason =
  | "embedding_api_error"
  | "embedding_empty_input"
  | "embedding_rate_limited";

export type EmbeddingSeamResult =
  | { ok: true; embedding: number[] }
  | { ok: false; rejectionReason: EmbeddingFailureReason; error?: unknown };

export interface EmbeddingSeamDeps {
  db?: typeof defaultDb;
  openai?: OpenAI | null;
}

interface CandidateInputRow {
  rawTitle: string | null;
  bodyText: string | null;
}

async function loadCandidateInput(
  db: typeof defaultDb,
  candidateId: string,
): Promise<CandidateInputRow | null> {
  const rows = await db
    .select({
      rawTitle: ingestionCandidates.rawTitle,
      bodyText: ingestionCandidates.bodyText,
    })
    .from(ingestionCandidates)
    .where(eq(ingestionCandidates.id, candidateId))
    .limit(1);
  return (rows[0] as CandidateInputRow | undefined) ?? null;
}

export async function computeEmbedding(
  candidateId: string,
  deps: EmbeddingSeamDeps = {},
): Promise<EmbeddingSeamResult> {
  const db = deps.db ?? defaultDb;
  const openai = deps.openai ?? null;

  if (!openai) {
    return { ok: false, rejectionReason: "embedding_api_error", error: "no_api_key" };
  }

  const row = await loadCandidateInput(db, candidateId);
  if (!row) {
    return { ok: false, rejectionReason: "embedding_empty_input" };
  }

  const title = row.rawTitle?.trim() ?? "";
  const body = row.bodyText?.trim() ?? "";
  if (!body) {
    return { ok: false, rejectionReason: "embedding_empty_input" };
  }

  const input = title ? `${title}\n\n${body}` : body;

  try {
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input,
    });
    const embedding = response.data[0]?.embedding;
    if (!embedding || embedding.length !== EMBEDDING_DIMENSIONS) {
      return {
        ok: false,
        rejectionReason: "embedding_api_error",
        error: `unexpected_dimension:${embedding?.length ?? 0}`,
      };
    }
    return { ok: true, embedding };
  } catch (err) {
    const status =
      typeof err === "object" && err !== null && "status" in err
        ? (err as { status?: number }).status
        : undefined;
    if (status === 429) {
      return { ok: false, rejectionReason: "embedding_rate_limited", error: err };
    }
    return { ok: false, rejectionReason: "embedding_api_error", error: err };
  }
}
