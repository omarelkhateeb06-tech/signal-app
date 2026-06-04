import type { Story } from "@/types/story";
import { isNativeStory, splitHook } from "@/lib/feedCard";

// Swiss Command Center — pure derivations that map the on-the-wire Story
// shape onto the briefing's structured sections. No fetching, no React;
// every value comes from fields already present on the feed payload.

export const SECTOR_LABEL: Record<string, string> = {
  ai: "ai",
  finance: "finance",
  semiconductors: "semiconductors",
};

// Compact tag used in the ranked-stream kicker (e.g. "semis · ai · fin").
export const SECTOR_SHORT: Record<string, string> = {
  ai: "ai",
  finance: "fin",
  semiconductors: "semis",
};

export const SECTOR_VAR: Record<string, string> = {
  ai: "var(--ai)",
  finance: "var(--finance)",
  semiconductors: "var(--semis)",
};

export function sectorColor(sector: string): string {
  return SECTOR_VAR[sector] ?? "var(--ink-muted)";
}

/**
 * MATCH % derived purely from rank (1-based) and source breadth, per the
 * Swiss spec. Rank 1 with multiple sources lands ~98%; the score decays
 * 4 points per rank and is floored at 50. A small breadth bonus (capped
 * at +8) rewards widely-covered stories.
 */
export function matchPercent(rank: number, sourceCount: number): number {
  // Mirrors the board-tuned relevanceFromRank shipped in SwissFeed (#141):
  // rank-decayed base floored at 50, a small breadth bonus, capped at 98 —
  // so the number is real (rank-derived) and naturally varies per card.
  const base = Math.max(50, 95 - (rank - 1) * 4);
  const breadthBonus = Math.min(8, Math.max(0, sourceCount - 1) * 3);
  return Math.min(98, base + breadthBonus);
}

export interface StoryView {
  /** Primary headline — native headline, or the ingested hook title. */
  title: string;
  /** The core-brief summary paragraph. */
  brief: string;
  /** Personalized "why it matters" body (12b template floor). */
  whyItMatters: string | null;
  /** Up to four key-takeaway bullets split from the role-neutral copy. */
  takeaways: string[];
}

/** First-sentence-aware split into headline + brief for any story kind. */
export function storyTitleAndBrief(story: Story): { title: string; brief: string } {
  const fallbackBrief = story.generic_commentary ?? story.why_it_matters ?? "";
  if (isNativeStory(story)) {
    return { title: story.headline, brief: fallbackBrief };
  }
  const { hookTitle, commentaryBody } = splitHook(
    story.generic_commentary,
    story.headline,
  );
  // For ingested stories the brief is the commentary remainder; fall back
  // to why_it_matters when the hook consumed the whole string.
  return {
    title: hookTitle,
    brief: commentaryBody ?? story.why_it_matters ?? "",
  };
}

// Sentence boundary for takeaway extraction: terminal punctuation followed
// by whitespace + a capital / opening quote. Kept local (the feedCard
// BOUNDARY also matches em-dashes, which we want to preserve inside a
// single takeaway here).
const SENTENCE_BOUNDARY = /(?<=[.!?])\s+(?=[A-Z"'“‘])/;

/**
 * Split the role-neutral commentary into discrete takeaway bullets. Drops
 * the first sentence (it becomes the hook/brief) for ingested stories so
 * the bullets don't echo the headline. Returns at most four clean,
 * non-trivial sentences.
 */
export function keyTakeaways(story: Story): string[] {
  const source = story.generic_commentary ?? story.why_it_matters ?? "";
  const sentences = source
    .split(SENTENCE_BOUNDARY)
    .map((s) => s.trim())
    .filter((s) => s.length > 24);

  // For ingested stories the opening sentence is already the hook title;
  // skip it so the takeaways add new information.
  const start = isNativeStory(story) ? 0 : 1;
  const picked = sentences.slice(start, start + 4);
  // Fall back to the full set if skipping left us empty (very short copy).
  return picked.length > 0 ? picked : sentences.slice(0, 4);
}

/**
 * "Indicators to monitor" — a short forward-looking line. There is no
 * dedicated field on the wire, so we surface the personalized why-it-
 * matters tail (or the story context) as the watch note. Returns null
 * when nothing meaningful is available rather than rendering an empty
 * section.
 */
export function indicatorsNote(story: Story): string | null {
  const candidate = story.context?.trim() || story.why_it_matters_to_you?.trim();
  return candidate && candidate.length > 0 ? candidate : null;
}

export function fullStoryView(story: Story): StoryView {
  const { title, brief } = storyTitleAndBrief(story);
  return {
    title,
    brief,
    whyItMatters: story.why_it_matters_to_you?.trim() || null,
    takeaways: keyTakeaways(story),
  };
}
