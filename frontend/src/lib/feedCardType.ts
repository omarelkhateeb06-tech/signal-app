import type { Story } from "@/types/story";

// Redesign v2 — content-type-aware feed cards.
//
// The moat is "format follows content type": a cross-sector chain, a research
// synthesis, a community brief, and a plain news dispatch should not render as
// the identical row. This module is the single, pure derivation that maps an
// on-the-wire Story onto a discriminated content type, derived ONLY from
// fields already present on the feed payload — no new endpoint, no inference
// from human-facing display strings.
//
// Signals used (authoritative, server-derived):
//   - `kind`            — "native" (SIGNAL editorial) vs "ingested".
//   - `generator_type`  — the native generator slug, mapped to a branded type.
//   - `sources.length`  — multi-source ingested events are news clusters.
//
// THE CONNECTION (cross-sector causal chain) is the flagship: it is the only
// type flagged `isHero`, and the ranked stream promotes the top-ranked one to
// a full-width illustrated hero instead of a peer row.

export type FeedCardType =
  | "connection" // cross-sector-chain-native  → THE CONNECTION (hero)
  | "research" //  arxiv-synthesis-native     → THE RESEARCH READ
  | "practitioner" // hn-synthesis-native      → PRACTITIONER BRIEF
  | "tool" //       tool-spotlight-native      → WORTH AN AFTERNOON
  | "earnings" //   earnings-reaction-native / content_type 'filing' → EARNINGS / SEC
  | "launch" //     content_type 'launch' (Product Hunt etc.) → THE LAUNCH
  | "native" //     other SIGNAL-authored      → SIGNAL ORIGINAL
  | "cluster" //    ingested, multi-source     → MULTI-SOURCE
  | "dispatch"; //  ingested, single-source    → DISPATCH

export interface CardTypeDescriptor {
  type: FeedCardType;
  /** Uppercase display label rendered in the card kicker. */
  label: string;
  /** Only THE CONNECTION earns the full-width illustrated hero slot. */
  isHero: boolean;
}

/** Native generator slug → branded content type. */
const GENERATOR_TYPE: Record<string, FeedCardType> = {
  "cross-sector-chain-native": "connection",
  "arxiv-synthesis-native": "research",
  "hn-synthesis-native": "practitioner",
  "tool-spotlight-native": "tool",
  "earnings-reaction-native": "earnings",
  // YouTube episode dispatches (Tier 2) — "what was said + why it matters"
  // briefs share the DISPATCH brand.
  "youtube-dwarkesh-native": "dispatch",
  "youtube-asianometry-native": "dispatch",
  "youtube-techtechpotato-native": "dispatch",
  "youtube-nopriors-native": "dispatch",
  "youtube-acquired-native": "dispatch",
};

/** Content type → uppercase brand label. */
export const CARD_TYPE_LABEL: Record<FeedCardType, string> = {
  connection: "THE CONNECTION",
  research: "THE RESEARCH READ",
  practitioner: "PRACTITIONER BRIEF",
  tool: "WORTH AN AFTERNOON",
  earnings: "EARNINGS / SEC",
  launch: "THE LAUNCH",
  native: "SIGNAL ORIGINAL",
  cluster: "MULTI-SOURCE",
  dispatch: "DISPATCH",
};

type CardTypeFields = Pick<
  Story,
  "kind" | "generator_type" | "sources" | "content_type"
>;

/**
 * Derive the content type for a story from its wire fields. Native posts map
 * by `generator_type` (falling back to the generic "SIGNAL ORIGINAL" when the
 * generator has no branded type); ingested SEC/earnings filings
 * (`content_type === 'filing'`) get the data-led earnings card ahead of the
 * source-breadth split; remaining ingested stories split on source breadth.
 */
export function deriveCardType(story: CardTypeFields): CardTypeDescriptor {
  let type: FeedCardType;

  if (story.kind === "native") {
    type =
      (story.generator_type && GENERATOR_TYPE[story.generator_type]) || "native";
  } else if (story.content_type === "filing") {
    type = "earnings";
  } else if (story.content_type === "launch") {
    type = "launch";
  } else if (story.content_type === "tool") {
    // Ingested GitHub repos (Phase 12R) share the WORTH AN AFTERNOON card with
    // the native tool-spotlight generator.
    type = "tool";
  } else if (story.sources.length > 1) {
    type = "cluster";
  } else {
    type = "dispatch";
  }

  return {
    type,
    label: CARD_TYPE_LABEL[type],
    isHero: type === "connection",
  };
}

/** True when a story is the flagship cross-sector chain (hero treatment). */
export function isConnectionStory(story: CardTypeFields): boolean {
  return deriveCardType(story).type === "connection";
}
