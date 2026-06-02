import type { Story } from "@/types/story";

// Three-section feed card model.
//
// For ingested stories the feed card is built from `generic_commentary`
// (role-neutral, on the wire) split into two parts plus the source
// headline:
//   1. Hook title       — the first sentence of generic_commentary, shown
//                          as the bold primary headline.
//   2. Source attribution — the source article's own headline, muted and
//                          smaller, directly below the hook title.
//   3. Commentary body   — the remainder of generic_commentary after the
//                          first sentence, as a separate paragraph.
//
// Native posts (SIGNAL-authored editorial) are exempt — their headline IS
// the editorial entry point, so they keep the classic headline-then-
// commentary layout. The feed wire intentionally strips `source_type`
// (see storyController.ts), so the only native signal the client has is
// the shared `source_name === "SIGNAL"` display name every native
// generator is seeded with.

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
 * three-section swap.
 */
export function isNativeStory(story: StorySourceFields): boolean {
  return effectiveSourceName(story) === NATIVE_SOURCE_NAME;
}

// Phase 12o — branded section labels for the four editorial native
// generators. Every native post shares the "SIGNAL" source display name;
// the generator slug (on the wire as `generator_type`) is what lets the
// card show a distinct brand per generator. Generators not in this map
// (e.g. github-trending-native) and all ingested stories keep their
// ordinary source attribution.
const NATIVE_BRAND_LABELS: Record<string, string> = {
  "arxiv-synthesis-native": "The Research Read",
  "hn-synthesis-native": "Practitioner Brief",
  "cross-sector-chain-native": "The Connection",
  "tool-spotlight-native": "Worth an Afternoon",
};

type StoryBrandFields = StorySourceFields & Pick<Story, "generator_type">;

/**
 * The source label to render in a card's kicker chip. For a native post
 * whose `generator_type` is one of the four branded generators, this is
 * the brand label ("The Research Read", …). For every other native post
 * it is the shared "SIGNAL" display name, and for ingested stories it is
 * the effective source name. Returns null only when no source name
 * resolves at all.
 */
export function sourceDisplayLabel(story: StoryBrandFields): string | null {
  const base = effectiveSourceName(story);
  if (base === NATIVE_SOURCE_NAME && story.generator_type) {
    return NATIVE_BRAND_LABELS[story.generator_type] ?? base;
  }
  return base;
}

/**
 * Phase 12r — maps a `generator_type` slug to a brand label for the
 * archive page (which has `NativeArchiveItem` shapes, not full `Story`
 * shapes). Mirrors the lookup inside `sourceDisplayLabel` but operates
 * directly on the slug so callers don't need to construct a Story.
 *
 * Returns the brand label for known generator slugs, "SIGNAL" for
 * unrecognised native slugs, and null for null/undefined (ingested items
 * or rows where no generator was resolved).
 */
export function brandLabelForGeneratorType(
  generatorType: string | null | undefined,
): string | null {
  if (!generatorType) return null;
  return NATIVE_BRAND_LABELS[generatorType] ?? NATIVE_SOURCE_NAME;
}

export interface HookSplit {
  /** Bold primary headline (first sentence of the hook). Never blank. */
  hookTitle: string;
  /** Remaining commentary after the first sentence, or null if none. */
  commentaryBody: string | null;
}

/** Drop a single trailing period (but keep `!` / `?` — they carry punch). */
function stripTrailingPeriod(s: string): string {
  return s.replace(/\.\s*$/, "").trim();
}

// First sentence boundary: terminal punctuation (`.`/`!`/`?`) followed by
// whitespace and a capital / opening quote, OR an em-dash clause break.
// The two alternatives are scanned together so we split on whichever
// occurs first, left to right.
const BOUNDARY = /([.!?])\s+(?=[A-Z"'“‘])|\s*—\s*/;

/**
 * Split `generic` into a hook title (first sentence) and a commentary body
 * (the remainder). When `generic` is null/empty the hook title falls back
 * to `fallbackHeadline` and the body is null, so a card never renders a
 * blank headline.
 *
 * The hook title is a single clean sentence — its trailing period is
 * stripped for display (it reads as a headline, not prose).
 */
export function splitHook(
  generic: string | null | undefined,
  fallbackHeadline: string,
): HookSplit {
  const text = (generic ?? "").trim();
  if (text === "") {
    return { hookTitle: fallbackHeadline, commentaryBody: null };
  }

  const match = BOUNDARY.exec(text);
  if (!match) {
    // Single sentence / no boundary — the whole thing is the hook.
    return { hookTitle: stripTrailingPeriod(text), commentaryBody: null };
  }

  const idx = match.index;
  const isPunctuation = match[1] != null;
  // For punctuation keep the terminal mark with the hook (then strip a
  // trailing period); for an em-dash break exclude the dash from both sides.
  const hookRaw = isPunctuation ? text.slice(0, idx + 1) : text.slice(0, idx);
  const body = text.slice(idx + match[0].length).trim();

  return {
    hookTitle: stripTrailingPeriod(hookRaw) || fallbackHeadline,
    commentaryBody: body.length > 0 ? body : null,
  };
}
