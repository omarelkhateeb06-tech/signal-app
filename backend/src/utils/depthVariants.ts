import { z } from "zod";
import { DEPTH_LEVELS, type WhyItMattersTemplate } from "../db/schema";
import { TierOutputSchema } from "../jobs/ingestion/tierGenerationSeam";

/**
 * Runtime validator for the depth-variant `why_it_matters_template` shape.
 * Accepts only the three canonical keys; extras fail. Min-length 1 on each
 * value so a partial / stub regeneration can't silently land empty strings
 * in prod.
 */
export const WhyItMattersTemplateSchema = z
  .object({
    accessible: z.string().min(1),
    briefed: z.string().min(1),
    technical: z.string().min(1),
  })
  .strict();

/**
 * Runtime validator for the 12e.5b per-tier `{thesis, support}` shape.
 * Distinct from `WhyItMattersTemplateSchema` (legacy 12a per-tier-string
 * shape) — both shapes coexist in the codebase:
 *   - `stories.why_it_matters_template` carries the legacy shape (12a).
 *   - `events.why_it_matters_template` carries this new shape (12e.5b),
 *     written by `writeEvent` in the ingestion pipeline.
 * Reuses `TierOutputSchema` (single source of truth for the per-tier
 * payload) from the tier-generation seam.
 */
export const TierTemplateSchema = z
  .object({
    accessible: TierOutputSchema,
    briefed: TierOutputSchema,
    technical: TierOutputSchema,
  })
  .strict();

export type TierTemplate = z.infer<typeof TierTemplateSchema>;

/**
 * Parses the JSON-encoded TEXT column. Returns `null` — not throwing — for
 * any of: null column, empty string, invalid JSON, wrong shape, legacy
 * sector-variant shape. Callers (v2 controller, digest compiler, etc.)
 * should treat `null` as "template not available" and fall back to the
 * role-neutral `why_it_matters` field.
 *
 * Lenient-on-read is deliberate: during the regeneration window between
 * deploying Phase 12a and finishing `npm run regenerate-depth-variants`,
 * the DB contains a mix of legacy (sector-variant) and new (depth-variant)
 * payloads. Throwing here would 500 the v2 endpoint mid-rollout.
 */
export function parseWhyItMattersTemplate(
  raw: string | null | undefined,
): WhyItMattersTemplate | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = WhyItMattersTemplateSchema.safeParse(parsed);
  if (!result.success) return null;
  return result.data;
}

/**
 * Strict variant used by the regeneration script and seed validator —
 * there, an invalid shape is a bug, not an "old data" condition, and we
 * want loud failures.
 */
export function assertWhyItMattersTemplate(raw: unknown): WhyItMattersTemplate {
  return WhyItMattersTemplateSchema.parse(raw);
}

/**
 * Strict-at-write variant for the 12e.5b per-tier shape. Used by
 * `writeEvent` (jobs/ingestion/writeEvent.ts) to validate the
 * `tier_outputs` payload before stringifying it into
 * `events.why_it_matters_template`. Throws on shape mismatch — by the
 * time `writeEvent` runs, the payload has already been validated by
 * `TierOutputSchema` per-tier inside `tierGenerationSeam.ts`, so a
 * failure here is a real bug worth surfacing loudly.
 */
export function assertTierTemplate(raw: unknown): TierTemplate {
  return TierTemplateSchema.parse(raw);
}

/**
 * Lenient counterpart to `assertTierTemplate`. Returns `null` on the
 * legacy 12a per-tier-string shape, malformed JSON, etc. Reader-side
 * code paths that consume `events.why_it_matters_template` should use
 * this; readers that still use `parseWhyItMattersTemplate` (legacy
 * shape) will return null for the new shape and fall back to
 * `events.why_it_matters` (the role-neutral string written alongside).
 * Reader-side migration to this function is tracked separately.
 */
export function parseTierTemplate(
  raw: string | null | undefined,
): TierTemplate | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = TierTemplateSchema.safeParse(parsed);
  if (!result.success) return null;
  return result.data;
}

export { DEPTH_LEVELS };
export type { WhyItMattersTemplate };
