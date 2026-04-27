// Phase 12e.1 — shared types for the ingestion pipeline.
//
// These are the contracts the poll worker, the enrichment worker, and
// the per-adapter implementations agree on. Live logic for any of them
// lands in 12e.2 onward; this file ships scaffolding only.

import type { IngestionAdapterType } from "../../db/schema";

// One item discovered by an adapter. Matches the rows the poll worker
// will write to `ingestion_candidates` in 12e.2 — the field shape is
// pre-normalized so every adapter produces the same envelope regardless
// of source format.
export interface Candidate {
  // Adapter-stable external identifier. RSS guid / arXiv id / EDGAR
  // accession number / HN item id / Reddit fullname. UNIQUE per
  // (ingestion_source_id, external_id).
  externalId: string;
  url: string;
  title: string | null;
  summary: string | null;
  publishedAt: Date | null;
  // Adapter-specific raw payload preserved for replay / debugging.
  // Persisted to ingestion_candidates.raw_payload as JSONB.
  rawPayload: Record<string, unknown>;
}

// Input handed to every adapter invocation. Adapters are pure of DB
// access — they take a source row's identifying fields and return the
// new candidates. Persistence happens in the worker layer.
export interface AdapterContext {
  sourceId: string;
  slug: string;
  adapterType: IngestionAdapterType;
  endpoint: string | null;
  config: Record<string, unknown>;
  // The most recent successful poll time, or null if the source has
  // never polled. Adapters can use it to skip already-seen items;
  // dedup ultimately enforced at the candidate-row level.
  lastPolledAt: Date | null;
}

// What an adapter returns. `candidates` may be empty (no new items
// since lastPolledAt). The worker uses this to advance
// `ingestion_sources.last_polled_at` and reset
// `consecutive_failure_count` on success.
export interface AdapterResult {
  candidates: Candidate[];
}

// Adapter function shape. Each per-type module under `adapters/`
// exports one of these. The registry at `adapters/index.ts` maps
// adapter_type -> AdapterFn.
export type AdapterFn = (ctx: AdapterContext) => Promise<AdapterResult>;
