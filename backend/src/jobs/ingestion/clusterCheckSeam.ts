// Phase 12e.6a — cluster check seam. Given a query embedding, find the
// most similar event in the trailing 72h window via pgvector cosine
// distance. The 12e.6b dispatch consumes the result: matched → attach as
// alternate event_source, unmatched → create new event with the candidate
// as primary source.
//
// Cosine distance operator in pgvector is `<=>`; similarity = 1 - distance.
// Drizzle's vector column maps `number[]` to a JSON.stringify'd array on
// the way out; pgvector accepts the same `[0.1,0.2,...]` string format
// when passed as a query parameter with an explicit `::vector` cast.

import { sql } from "drizzle-orm";

import { db as defaultDb } from "../../db";

const DEFAULT_THRESHOLD = 0.85;
const WINDOW_HOURS = 72;

export type ClusterCheckResult =
  | { matched: true; matchedEventId: string; similarity: number }
  | { matched: false };

export interface ClusterCheckDeps {
  db?: typeof defaultDb;
  // Override threshold for tests; production reads EMBEDDING_CLUSTER_THRESHOLD.
  threshold?: number;
}

function readThresholdFromEnv(): number {
  const raw = process.env.EMBEDDING_CLUSTER_THRESHOLD;
  if (!raw) return DEFAULT_THRESHOLD;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return DEFAULT_THRESHOLD;
  }
  return parsed;
}

export async function checkCluster(
  embedding: number[],
  deps: ClusterCheckDeps = {},
): Promise<ClusterCheckResult> {
  const db = deps.db ?? defaultDb;
  const threshold = deps.threshold ?? readThresholdFromEnv();

  // pgvector accepts the bracketed-array string format with an explicit
  // ::vector cast at parameter binding. See drizzle-orm vector_extension
  // mapToDriverValue (JSON.stringify) for the matching encoding the
  // column-side write path uses.
  const queryVectorLiteral = JSON.stringify(embedding);

  const result = await db.execute(sql`
    SELECT
      id::text AS id,
      1 - (embedding <=> ${queryVectorLiteral}::vector) AS similarity
    FROM events
    WHERE published_at > now() - interval '${sql.raw(String(WINDOW_HOURS))} hours'
      AND embedding IS NOT NULL
    ORDER BY embedding <=> ${queryVectorLiteral}::vector
    LIMIT 1
  `);

  // Drizzle's `db.execute` returns either { rows: [...] } (node-postgres
  // QueryResult) or the row array directly depending on driver. Normalize.
  const resultUnknown = result as unknown;
  const rows = Array.isArray(resultUnknown)
    ? (resultUnknown as Record<string, unknown>[])
    : ((resultUnknown as { rows?: Record<string, unknown>[] }).rows ?? []);
  const top = rows[0];
  if (!top) return { matched: false };

  const id = typeof top.id === "string" ? top.id : null;
  const similarity = Number(top.similarity);
  if (!id || !Number.isFinite(similarity) || similarity < threshold) {
    return { matched: false };
  }

  return { matched: true, matchedEventId: id, similarity };
}
