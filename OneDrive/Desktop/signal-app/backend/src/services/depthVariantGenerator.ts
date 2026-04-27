import Anthropic from "@anthropic-ai/sdk";
import type { DepthLevel, WhyItMattersTemplate } from "../db/schema";
import { DEPTH_LEVELS } from "../db/schema";

// Haiku is the locked model for bulk regeneration (Phase 12a). Latency and
// cost dominate at 20+ stories × 3 variants; quality ceiling is explicitly
// out of scope — Phase 12c revisits prompt + model selection.
export const DEPTH_VARIANT_MODEL = "claude-haiku-4-5";

const DEPTH_GUIDANCE: Record<DepthLevel, string> = {
  accessible:
    "Write for a smart non-specialist — a founder, journalist, or generalist executive. " +
    "Use plain language. Assume no domain jargon. Prioritize the single most important " +
    "thing the reader should walk away knowing. ~80–120 words.",
  briefed:
    "Write for a working professional in the sector but not an insider at this specific " +
    "company. Light domain terminology is fine. Focus on implications and second-order " +
    "effects over narrative recap. ~120–160 words.",
  technical:
    "Write for a domain insider — a practitioner who already knows the context and wants " +
    "the non-obvious read. Use precise terminology. Cite specific numbers, mechanisms, or " +
    "people when they change the interpretation. Skip anything introductory. ~160–220 words.",
};

export interface DepthVariantGeneratorDeps {
  client?: Pick<Anthropic["messages"], "create">;
  model?: string;
}

export interface StoryForDepthGen {
  id: string;
  headline: string;
  sector: string;
  context: string;
  whyItMatters: string;
}

function buildPrompt(story: StoryForDepthGen, depth: DepthLevel): string {
  return [
    `You are writing the "why this matters" commentary for a ${story.sector} story in a professional intelligence product.`,
    "",
    `Headline: ${story.headline}`,
    "",
    `Context: ${story.context}`,
    "",
    `Role-neutral baseline (for tone and facts, not to copy verbatim): ${story.whyItMatters}`,
    "",
    `Audience depth: ${depth}. ${DEPTH_GUIDANCE[depth]}`,
    "",
    "Output ONLY the commentary paragraph(s). No preamble, no headers, no bullet lists, no quotes around the output.",
  ].join("\n");
}

/**
 * Builds an Anthropic client from ANTHROPIC_API_KEY. Throws on missing key
 * — this is a CLI-driven one-shot script, not a server hot path; failing
 * fast is preferable to silent no-op.
 */
export function buildAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is required for regenerate-depth-variants. Set it in your env and rerun.",
    );
  }
  return new Anthropic({ apiKey });
}

/**
 * Calls Haiku three times (once per depth) and returns the assembled
 * `WhyItMattersTemplate`. Requests are sequential on purpose — keeping
 * throughput at ~3 requests/story avoids burst-limit headaches for a
 * one-time script, and the regeneration takes minutes, not hours, for
 * the 20-row corpus.
 */
export async function generateDepthVariantsForStory(
  story: StoryForDepthGen,
  deps: DepthVariantGeneratorDeps = {},
): Promise<WhyItMattersTemplate> {
  const client = deps.client ?? buildAnthropicClient().messages;
  const model = deps.model ?? DEPTH_VARIANT_MODEL;

  const out: Partial<Record<DepthLevel, string>> = {};
  for (const depth of DEPTH_LEVELS) {
    const res = await client.create({
      model,
      max_tokens: 600,
      messages: [{ role: "user", content: buildPrompt(story, depth) }],
    });
    // Collect all text blocks in order. Haiku typically returns one, but
    // the SDK models this as an array — don't assume shape.
    const text = res.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("\n")
      .trim();
    if (!text) {
      throw new Error(
        `Empty commentary from model for story ${story.id} at depth "${depth}"`,
      );
    }
    out[depth] = text;
  }
  // Cast is safe — the for-loop above writes every depth before we return.
  return out as WhyItMattersTemplate;
}
