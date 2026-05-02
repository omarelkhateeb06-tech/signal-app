// Phase 12e.5c sub-step 6 — per-stage Sentry tagging convention for the
// ingestion enrichment chain.
//
// Audit §6 found the codebase had essentially zero per-job Sentry
// instrumentation (5 total call sites at audit time, none using
// withScope/setTag). This helper establishes the convention: each
// failure surfaced from a stage in `processEnrichmentJob` (relevance,
// facts, tiers, write_event) goes through `captureIngestionStageFailure`,
// which sets a uniform tag set so soak observability and 12e.8 metrics
// can pivot by stage / candidate / source / rejection class.
//
// Scope isolation discipline:
//   - The withScope callback runs SYNCHRONOUSLY. No `await` inside it.
//     Concurrent ingestion jobs (BullMQ concurrency=2) would otherwise
//     leak scope state across workers.
//   - Callers do all `await`s BEFORE invoking this helper, then call it
//     synchronously with the already-resolved rejection details.
//   - The helper makes a single setTag-then-captureException pass and
//     returns — nothing escapes the scope.
//
// The helper is a safe no-op when Sentry is not initialized (no
// SENTRY_DSN). The Sentry SDK's calls already short-circuit in that
// case; we don't need an explicit isSentryEnabled() guard.

import * as Sentry from "@sentry/node";

export type IngestionStage =
  | "relevance"
  | "facts"
  | "tiers"
  | "write_event"
  // 12e.5c sub-step 7 — BullMQ-level failure, distinct from the
  // orchestration-stage failures above. Fires from
  // enrichmentWorker.ts's `failed` handler when a job throws past
  // processEnrichmentJob's structured-envelope returns. Typically:
  // unhandled exception in a seam, transient PG/Redis error during
  // status writes, or any other error not caught and surfaced as a
  // failed envelope upstream.
  | "worker_failed";

export interface IngestionStageFailureContext {
  stage: IngestionStage;
  candidateId: string;
  // Slug of the ingestion source that produced the candidate. Optional —
  // when the snapshot couldn't load (race condition, deleted candidate),
  // the helper still captures with the stage + candidate_id tags but
  // omits source_slug.
  sourceSlug: string | null;
  // Stable rejection-class string from the stage's *_REASONS taxonomy
  // (e.g., "facts_parse_error", "TIER_TIMEOUT", "write_event_error").
  // Used as a Sentry tag and as the captured-error message when no
  // explicit error object is provided.
  rejectionReason: string;
  // Optional explicit error object to capture (e.g., a ZodError thrown
  // by writeEvent's assertTierTemplate). When omitted, the helper
  // synthesizes an Error from the rejection reason for capture.
  err?: unknown;
  // Optional additional tags appended after the canonical four. Used by
  // the worker's failed handler to surface BullMQ context (attempt
  // count, queue name, etc.). Keys are forwarded verbatim — caller
  // controls namespacing (recommend prefixing with the subsystem name,
  // e.g., "bullmq.attempt").
  extraTags?: Record<string, string>;
}

/**
 * Capture an ingestion-stage failure to Sentry with the canonical tag
 * set. Synchronous; safe to call inside any branch that has already
 * awaited the underlying stage call.
 */
export function captureIngestionStageFailure(
  ctx: IngestionStageFailureContext,
): void {
  Sentry.withScope((scope) => {
    scope.setTag("ingestion.stage", ctx.stage);
    scope.setTag("ingestion.candidate_id", ctx.candidateId);
    if (ctx.sourceSlug) {
      scope.setTag("ingestion.source_slug", ctx.sourceSlug);
    }
    scope.setTag("ingestion.rejection_reason", ctx.rejectionReason);
    if (ctx.extraTags) {
      for (const [key, value] of Object.entries(ctx.extraTags)) {
        scope.setTag(key, value);
      }
    }
    const err =
      ctx.err instanceof Error
        ? ctx.err
        : new Error(
            `ingestion.${ctx.stage} failed: ${ctx.rejectionReason}` +
              (ctx.err !== undefined ? ` (${String(ctx.err)})` : ""),
          );
    Sentry.captureException(err);
  });
}
