// Phase 12b — onboarding option catalog.
//
// Duplicated in `frontend/src/lib/onboardingTopics.ts`. There is no
// shared workspace; when you edit one, edit the other. The Zod
// validators on the backend enforce membership in these lists, so the
// two files diverging silently is a real bug (it will manifest as the
// UI offering an option that the server rejects with INVALID_INPUT).
//
// The canonical copy lives here. Keep the two files byte-identical in
// the option sets (frontend adds display labels; backend keeps only
// the value tuples since it never renders).

export const SECTORS = ["ai", "finance", "semiconductors"] as const;
export type Sector = (typeof SECTORS)[number];

export const ROLES = [
  "engineer",
  "researcher",
  "manager",
  "vc",
  "analyst",
  "founder",
  "executive",
  "student",
  "other",
] as const;
export type Role = (typeof ROLES)[number];

// Listed in spec order (Screen 3). `just_starting_out` and `leadership`
// were added in Phase 12b fix-it — `just_starting_out` captures "brand
// new / bootcamp / pre-career" which was missing between `student` and
// `junior`, and `leadership` separates people-management at the
// director-and-up level from the `executive` C-suite bucket.
export const SENIORITIES = [
  "student",
  "just_starting_out",
  "junior",
  "mid",
  "senior",
  "principal_plus",
  "executive",
  "leadership",
] as const;
export type Seniority = (typeof SENIORITIES)[number];

export const GOALS = [
  "stay_current",
  "deep_learning",
  "find_opportunities",
  "network",
  "career_growth",
  "investing",
  "research",
] as const;
export type Goal = (typeof GOALS)[number];

// Default skip-value for Screen 6 (goals). Stored as-is on the profile
// when the user clicks Skip — a single-element tuple, not an empty
// array, so downstream consumers can rely on goals being non-empty.
export const DEFAULT_GOAL: Goal = "stay_current";

// Topic catalog per sector. Screen 5 shows these as multi-select
// checkboxes for every sector the user selected on Screen 1. Skip on
// Screen 5 persists *all* topics for every selected sector (the
// "I want to see everything in my sectors" interpretation).
// Issue #24 — consolidated June 2026 from 10 fine-grained topics/sector to 5
// broad categories/sector. The old 12-20-style granularity was too in-the-
// weeds for users who haven't formed specific opinions, degrading the
// matched_interests signal (over/under-picking). Pre-existing user_topic_
// interests rows with the old values are harmless: they're passed to
// commentary as plain matched-topic strings and simply don't pre-fill against
// the new option set on a profile edit (the user re-picks broad categories).
export const TOPICS_BY_SECTOR = {
  ai: [
    "models_and_research",
    "infrastructure",
    "agents",
    "products_and_apps",
    "safety_and_policy",
  ],
  finance: [
    "markets_and_macro",
    "private_capital",
    "crypto",
    "policy_and_regulation",
    "quant_research",
  ],
  semiconductors: [
    "design_and_eda",
    "manufacturing",
    "chips_and_accelerators",
    "supply_and_policy",
    "applications",
  ],
} as const satisfies Record<Sector, readonly string[]>;

export type Topic =
  | (typeof TOPICS_BY_SECTOR.ai)[number]
  | (typeof TOPICS_BY_SECTOR.finance)[number]
  | (typeof TOPICS_BY_SECTOR.semiconductors)[number];

// Flat list of "sector:topic" strings for membership validation.
export const VALID_TOPIC_PAIRS = new Set<string>(
  Object.entries(TOPICS_BY_SECTOR).flatMap(([sector, topics]) =>
    topics.map((topic) => `${sector}:${topic}`),
  ),
);

export function isValidTopicForSector(sector: string, topic: string): boolean {
  return VALID_TOPIC_PAIRS.has(`${sector}:${topic}`);
}
