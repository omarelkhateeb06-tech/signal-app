import { z } from "zod";
import { DEPTH_LEVELS, type WhyItMattersTemplate } from "../db/schema";

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

export { DEPTH_LEVELS };
export type { WhyItMattersTemplate };
