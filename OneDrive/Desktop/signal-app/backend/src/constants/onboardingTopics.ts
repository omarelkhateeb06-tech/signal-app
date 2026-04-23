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

export const SENIORITIES = [
  "student",
  "junior",
  "mid",
  "senior",
  "principal_plus",
  "executive",
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
export const TOPICS_BY_SECTOR = {
  ai: [
    "foundation_models",
    "training_infra",
    "inference_infra",
    "agents",
    "multimodal",
    "safety_alignment",
    "research_papers",
    "ai_policy",
    "ai_products",
    "open_source_models",
  ],
  finance: [
    "public_markets",
    "rates_and_macro",
    "credit",
    "private_equity",
    "venture_capital",
    "m_and_a",
    "crypto",
    "regulation_and_policy",
    "earnings",
    "quantitative_research",
  ],
  semiconductors: [
    "foundries",
    "advanced_packaging",
    "eda",
    "memory",
    "gpu_accelerators",
    "networking_silicon",
    "export_controls",
    "supply_chain",
    "automotive_silicon",
    "edge_and_iot",
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
