// Phase 12n.2 — native generator framework contracts.
//
// A native generator produces original editorial "native posts" from
// already-ingested public signals (the first is GitHub trending). Unlike
// an adapter — which pulls third-party items off a feed — a generator
// AUTHORS the post body via Haiku, then emits a NativeCandidate that the
// runner persists as an `ingestion_candidates` row and pushes through the
// native enrichment orchestrator (facts → tiers → writeEvent).
//
// Mirrors the adapter framework (types.ts / adapters/index.ts) so the two
// stay structurally parallel: a typed unit (NativeGenerator) + a registry
// keyed by the ingestion_sources.slug it writes under.

import type { Sector } from "../relevanceSeam";

// One authored native post, pre-persistence. The runner maps this onto an
// `ingestion_candidates` row: headline → raw_title, body → body_text
// (carried as the pre-fetched authored body so the heuristic fetch is
// never invoked), sector → sector, etc. The candidate is then handed to
// processNativeEnrichment.
export interface NativeCandidate {
  // Stable per-source identifier for dedup via the
  // (ingestion_source_id, external_id) unique constraint. Re-running the
  // generator over the same trending repo is a no-op insert.
  externalId: string;
  // Source pointer — the public artifact the post is about (e.g. the
  // GitHub repo URL). Becomes events.primary_source_url.
  url: string;
  // AI-authored headline (becomes raw_title → events.headline).
  headline: string;
  // AI-authored post body, hook-first (becomes body_text). This is the
  // text facts extraction + tier generation run against. Plain text.
  body: string;
  // Sector the post belongs to. Set by the generator — native posts skip
  // the LLM relevance gate, so this value is authoritative.
  sector: Sector;
  // Short summary for raw_summary (optional; the source artifact's own
  // description is a reasonable value). Null when the generator has none.
  summary?: string | null;
  // Raw generation inputs preserved for replay / debugging
  // (ingestion_candidates.raw_payload).
  rawPayload: Record<string, unknown>;
}

// One observability record emitted as a generator evaluates a candidate
// signal through its qualification stages. Diagnostics-only — a generator
// emits these when ctx.onDiagnostic is set (dry-run / verbose); production
// generation leaves the sink undefined and emits nothing. The shape is
// deliberately generic so any future generator can reuse it.
export interface GeneratorDiagnostic {
  // Which gate stage produced this record (e.g. "prefilter", "qualify").
  stage: string;
  // Human identifier for the considered signal (e.g. a repo full name).
  identifier: string;
  url?: string;
  decision: "pass" | "reject";
  // The first failing floor name when rejected; null on pass.
  reason: string | null;
  // Human "value vs threshold" string for a rejection (e.g.
  // "age 12d < 30d"). Omitted on pass.
  detail?: string;
  // The raw signals the gate evaluated, key→value, in print order.
  signals?: Record<string, unknown>;
}

export interface NativeGeneratorContext {
  // Injectable clock so tests get deterministic timestamps and the CLI
  // can pass a fixed "now" if needed.
  now: () => Date;
  // Optional diagnostics sink. When provided (dry-run / verbose), the
  // generator reports each candidate's per-stage gate evaluation here.
  // Undefined in production — emitting is purely observational and never
  // affects which candidates are produced.
  onDiagnostic?: (record: GeneratorDiagnostic) => void;
}

export interface NativeGenerator {
  // The ingestion_sources.slug this generator writes candidates under.
  // Must match a seeded source row whose adapter_type='native_generator'.
  slug: string;
  generate(ctx: NativeGeneratorContext): Promise<NativeCandidate[]>;
}
