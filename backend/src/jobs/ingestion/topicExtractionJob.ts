// Topic-extraction job — populates events.topics for the "In Focus" chips.
//
// Decoupled from the ingestion write path on purpose: extraction is an LLM
// call per event (cost-bearing, accepted), and running it inline in
// enrichmentJob's transaction would add risk + latency to the hot path. This
// job drains events that have not yet been attempted (topics_extracted_at IS
// NULL), oldest-first, in bounded batches. It is the same code path for the
// one-time backfill (CLI) and the steady-state trickle (scheduler).
//
// Soft-fail throughout: a transient LLM failure leaves topics_extracted_at
// NULL so the row is retried next run; a genuinely-empty result stamps
// topics_extracted_at so it is not retried forever; one bad event never
// aborts the batch.

import { eq, isNull } from "drizzle-orm";

import { db as defaultDb } from "../../db";
import { events } from "../../db/schema";
import {
  callHaikuForCommentary,
  type HaikuClientDeps,
} from "../../services/haikuCommentaryClient";
import {
  buildTopicExtractionPrompt,
  MAX_TOPICS,
  MAX_TOPIC_LENGTH,
  TOPIC_EXTRACTION_ASSISTANT_PREFILL,
  TOPIC_EXTRACTION_MAX_TOKENS,
} from "../../llm/prompts/ingestion/topicExtraction";

// Per-run cap — bounds Haiku spend and keeps a scheduled run short. The
// backfill drains the corpus over several runs; new events trickle in well
// under this.
export const TOPIC_EXTRACTION_BATCH = 50;

/**
 * Parse the model's JSON-array output into a clean, deduped, length- and
 * count-capped list of canonical topic labels. Pure; returns [] on any
 * malformed output (non-JSON, non-array, all-empty).
 */
export function parseTopics(raw: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of parsed) {
    if (typeof item !== "string") continue;
    const cleaned = item
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, MAX_TOPIC_LENGTH)
      .trim();
    if (cleaned.length === 0) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
    if (out.length >= MAX_TOPICS) break;
  }
  return out;
}

export interface TopicExtractionDeps {
  db?: typeof defaultDb;
  haiku?: HaikuClientDeps;
}

export interface EventForTopics {
  id: string;
  headline: string;
  context: string;
  sector: string;
}

/**
 * Extract + persist topics for one event.
 *   - LLM call fails (transient) → return []; topics_extracted_at left NULL so
 *     the row is retried on a later run.
 *   - LLM call succeeds → stamp topics_extracted_at (so an empty result is not
 *     retried) and store whatever parseTopics yields (possibly []).
 * Returns the stored topics.
 */
export async function extractTopicsForEvent(
  row: EventForTopics,
  deps: TopicExtractionDeps = {},
): Promise<string[]> {
  const db = deps.db ?? defaultDb;
  const prompt = buildTopicExtractionPrompt({
    headline: row.headline,
    context: row.context,
    sector: row.sector,
  });

  const result = await callHaikuForCommentary(prompt, deps.haiku, {
    assistantPrefill: TOPIC_EXTRACTION_ASSISTANT_PREFILL,
    maxTokens: TOPIC_EXTRACTION_MAX_TOKENS,
    callSite: "topics",
  });
  if (!result.ok) return [];

  const topics = parseTopics(result.text);
  await db
    .update(events)
    .set({ topics, topicsExtractedAt: new Date() })
    .where(eq(events.id, row.id));
  return topics;
}

export interface TopicExtractionRunResult {
  processed: number;
  updated: number;
}

/**
 * Drain up to `limit` not-yet-attempted events (oldest-first), extracting
 * topics for each. Per-event soft-fail. Returns counts for the caller to log.
 */
export async function runTopicExtraction(
  deps: TopicExtractionDeps = {},
  limit = TOPIC_EXTRACTION_BATCH,
): Promise<TopicExtractionRunResult> {
  const db = deps.db ?? defaultDb;

  const rows = (await db
    .select({
      id: events.id,
      headline: events.headline,
      context: events.context,
      sector: events.sector,
    })
    .from(events)
    .where(isNull(events.topicsExtractedAt))
    .orderBy(events.createdAt)
    .limit(limit)) as EventForTopics[];

  let updated = 0;
  for (const row of rows) {
    try {
      const topics = await extractTopicsForEvent(row, deps);
      if (topics.length > 0) updated++;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `[topic-extraction] event=${row.id} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    `[topic-extraction] processed=${rows.length} updated=${updated} (batch=${limit})`,
  );
  return { processed: rows.length, updated };
}
