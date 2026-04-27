// Phase 12c — matched_interests computation.
//
// Given the story's sector and the user's declared sectors + topic
// selections, returns which of the user's profile signals "match" the
// story. Fed into the Haiku prompt so commentary can lean on concrete
// overlaps (e.g. "as a mid-career engineer interested in foundation
// models..."). Also fed into the tiered fallback so Tier 2 vs Tier 3
// selection is observable without re-querying the DB.
//
// Pure — no DB access, no I/O. The caller loads the pieces it needs
// (from user_profiles + user_topic_interests) and hands them in.

export interface MatchedInterestsInput {
  storySector: string;
  userSectors: string[] | null | undefined;
  userTopicsForSector: ReadonlyArray<{ sector: string; topic: string }> | null | undefined;
}

export interface MatchedInterests {
  // True iff the story's sector appears in the user's onboarded sectors.
  // False here is the strongest "this story is off-sector for this user"
  // signal — rare in practice because the feed filters by sector, but
  // possible on direct story-detail reads.
  matchedSector: boolean;
  // User's topic picks *within the story's sector* only. We don't count
  // cross-sector topics — a "foundation_models" pick against an AI user
  // reading a finance story is not a relevant match. Widened to string
  // (not the Topic union) because values come out of
  // user_topic_interests as text; membership has already been enforced
  // at insert time by the onboarding controller's Zod schema.
  matchedTopics: string[];
}

export function computeMatchedInterests(input: MatchedInterestsInput): MatchedInterests {
  const userSectors = input.userSectors ?? [];
  const userTopics = input.userTopicsForSector ?? [];

  const matchedSector = userSectors.includes(input.storySector);

  // Filter topic picks to those declared against the story's sector.
  // Dedupe defensively — the composite PK on user_topic_interests
  // already prevents dupes in the DB, but callers may pass arrays
  // assembled from multiple queries.
  const seen = new Set<string>();
  const matchedTopics: string[] = [];
  for (const t of userTopics) {
    if (t.sector !== input.storySector) continue;
    if (seen.has(t.topic)) continue;
    seen.add(t.topic);
    matchedTopics.push(t.topic);
  }

  return { matchedSector, matchedTopics };
}
