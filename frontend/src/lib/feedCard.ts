import type { Story } from "@/types/story";

// Hook-as-title feed card model.
//
// For ingested stories the feed card inverts its hierarchy: the
// accessible-tier commentary thesis (the "hook") becomes the primary
// headline, and the source article's own headline drops to a secondary
// attribution line. This sells the "why it matters to you" promise as
// the entry point rather than re-printing the wire headline.
//
// Native posts (SIGNAL-authored editorial) are exempt — their headline
// IS the editorial entry point already, so they keep the classic
// headline-then-commentary layout. The feed wire intentionally strips
// `source_type` (see storyController.ts), so the only native signal the
// client has is the shared `source_name === "SIGNAL"` display name that
// every native generator is seeded with.

/** Display name shared by every native (SIGNAL-authored) generator. */
export const NATIVE_SOURCE_NAME = "SIGNAL";

type StorySourceFields = Pick<Story, "source_name" | "sources">;

/** Effective source name: explicit `source_name`, else the primary source. */
function effectiveSourceName(story: StorySourceFields): string | null {
  return story.source_name ?? story.sources[0]?.name ?? null;
}

/**
 * A story is "native" (SIGNAL editorial) when its effective source name is
 * the shared native display name. Native cards are left untouched by the
 * hook-as-title swap.
 */
export function isNativeStory(story: StorySourceFields): boolean {
  return effectiveSourceName(story) === NATIVE_SOURCE_NAME;
}

export interface CardHeadline {
  /** Bold primary headline. Never blank. */
  primary: string;
  /** Secondary source-headline attribution, or null when not applicable. */
  attribution: string | null;
}

/**
 * Resolve the primary headline + secondary attribution for a feed card.
 *
 * - Native story → classic layout: source headline stays primary, no
 *   attribution swap (caller renders commentary below as before).
 * - Ingested with a non-empty hook → hook becomes primary, the source
 *   headline becomes the attribution line.
 * - Ingested with an empty/missing hook → fall back to the source
 *   headline as primary so the card never renders a blank headline.
 */
export function resolveCardHeadline(
  story: Pick<Story, "headline" | "source_name" | "sources">,
  hook: string | null | undefined,
): CardHeadline {
  const hookText = (hook ?? "").trim();
  if (isNativeStory(story) || hookText === "") {
    return { primary: story.headline, attribution: null };
  }
  return { primary: hookText, attribution: story.headline };
}
