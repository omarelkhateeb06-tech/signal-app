// Phase 12b — onboarding option catalog (frontend mirror).
//
// Canonical value lists live in
// `backend/src/constants/onboardingTopics.ts`. There is no shared
// workspace; when you edit one, edit the other. Backend Zod validators
// enforce membership in these lists, so silent drift manifests as
// INVALID_INPUT responses on completion.
//
// This file keeps the value tuples in sync with backend, and adds
// frontend-only display labels + descriptions. Existing consumers
// (SectorFilter, search, settings, teams/settings) rely on SECTORS,
// ROLES, GOALS, and EMAIL_FREQUENCIES — keep those export names stable.

import type { EmailFrequency } from "@/types/auth";

export interface SectorOption {
  value: string;
  label: string;
  description: string;
}

export interface LabeledOption {
  value: string;
  label: string;
  description?: string;
}

// ---------- Sectors (Screen 1) ----------

export const SECTORS: readonly SectorOption[] = [
  {
    value: "ai",
    label: "AI",
    description: "Model releases, research, infra, safety, and the economics of compute.",
  },
  {
    value: "finance",
    label: "Finance",
    description: "Markets, rates, credit, private equity, venture, and policy shifts.",
  },
  {
    value: "semiconductors",
    label: "Semiconductors",
    description: "Foundries, design, packaging, export controls, and supply chains.",
  },
] as const;

export const SECTOR_VALUES = SECTORS.map((s) => s.value) as readonly string[];

// ---------- Roles (Screen 2) ----------

export const ROLES: readonly LabeledOption[] = [
  { value: "engineer", label: "Engineer" },
  { value: "researcher", label: "Researcher" },
  { value: "manager", label: "Manager" },
  { value: "vc", label: "VC" },
  { value: "analyst", label: "Analyst" },
  { value: "founder", label: "Founder" },
  { value: "executive", label: "Executive" },
  { value: "student", label: "Student" },
  { value: "other", label: "Other" },
] as const;

// ---------- Seniority (Screen 3) ----------

// Labels match the spec (Phase 12b fix-it Fix 4 / Issue #10). Values
// are kept stable across label changes so existing profile rows and
// backend tests don't need a data migration — only the display strings
// changed. `just_starting_out` and `leadership` are new additions.
export const SENIORITIES: readonly LabeledOption[] = [
  { value: "student", label: "Student" },
  { value: "just_starting_out", label: "Just starting out" },
  { value: "junior", label: "Early career (0-3 years)" },
  { value: "mid", label: "Mid-career (4-10 years)" },
  { value: "senior", label: "Senior" },
  { value: "principal_plus", label: "Experienced (10+ years)" },
  { value: "executive", label: "Executive" },
  { value: "leadership", label: "Leadership" },
] as const;

// ---------- Depth preference (Screen 6 as of Phase 12c; was Screen 4 in 12b) ----------
//
// Position change only — the option list and default are unchanged.
// Depth moved from Screen 4 to Screen 6 (after goals) so users anchor
// the depth pick on concrete selections they've already made rather
// than as an abstract preference up front.

export const DEPTH_PREFERENCES: readonly LabeledOption[] = [
  {
    value: "accessible",
    label: "Accessible",
    description: "Plain-English framing, no jargon. Best for a curious non-expert.",
  },
  {
    value: "standard",
    label: "Standard",
    description: "Working-professional framing. The free-tier default.",
  },
  {
    value: "technical",
    label: "Technical",
    description: "Insider / expert framing. Assumes the vocabulary of the sector.",
  },
] as const;

export const DEFAULT_DEPTH_PREFERENCE = "standard" as const;

// ---------- Topics per sector (Screen 4 as of Phase 12c; was Screen 5 in 12b) ----------

export interface TopicOption {
  value: string;
  label: string;
}

export const TOPICS_BY_SECTOR: Readonly<Record<string, readonly TopicOption[]>> = {
  ai: [
    { value: "foundation_models", label: "Foundation models" },
    { value: "training_infra", label: "Training infrastructure" },
    { value: "inference_infra", label: "Inference infrastructure" },
    { value: "agents", label: "Agents" },
    { value: "multimodal", label: "Multimodal" },
    { value: "safety_alignment", label: "Safety & alignment" },
    { value: "research_papers", label: "Research papers" },
    { value: "ai_policy", label: "AI policy" },
    { value: "ai_products", label: "AI products" },
    { value: "open_source_models", label: "Open-source models" },
  ],
  finance: [
    { value: "public_markets", label: "Public markets" },
    { value: "rates_and_macro", label: "Rates & macro" },
    { value: "credit", label: "Credit" },
    { value: "private_equity", label: "Private equity" },
    { value: "venture_capital", label: "Venture capital" },
    { value: "m_and_a", label: "M&A" },
    { value: "crypto", label: "Crypto" },
    { value: "regulation_and_policy", label: "Regulation & policy" },
    { value: "earnings", label: "Earnings" },
    { value: "quantitative_research", label: "Quantitative research" },
  ],
  semiconductors: [
    { value: "foundries", label: "Foundries" },
    { value: "advanced_packaging", label: "Advanced packaging" },
    { value: "eda", label: "EDA" },
    { value: "memory", label: "Memory" },
    { value: "gpu_accelerators", label: "GPUs & accelerators" },
    { value: "networking_silicon", label: "Networking silicon" },
    { value: "export_controls", label: "Export controls" },
    { value: "supply_chain", label: "Supply chain" },
    { value: "automotive_silicon", label: "Automotive silicon" },
    { value: "edge_and_iot", label: "Edge & IoT" },
  ],
};

// ---------- Goals (Screen 5 as of Phase 12c; was Screen 6 in 12b, default on skip) ----------

// Labels match the spec (Phase 12b fix-it Fix 4 / Issue #10). Values
// are unchanged so persisted profiles keep working. The `deep_learning`
// label was confusing in an AI-sector app (it collided with the ML
// term of art); relabelled to "Deepen expertise in a topic".
export const GOALS: readonly LabeledOption[] = [
  { value: "stay_current", label: "Stay current on my industry" },
  { value: "deep_learning", label: "Deepen expertise in a topic" },
  { value: "find_opportunities", label: "Find opportunities" },
  { value: "network", label: "Build my network" },
  { value: "career_growth", label: "Grow my career" },
  { value: "investing", label: "Inform investing decisions" },
  { value: "research", label: "Research and analysis" },
] as const;

export const DEFAULT_GOAL = "stay_current" as const;

// ---------- Digest preference (Screen 7) ----------

export const DIGEST_PREFERENCES: readonly LabeledOption[] = [
  { value: "morning", label: "Morning digest" },
  { value: "evening", label: "Evening digest" },
  { value: "none", label: "No digest" },
] as const;

// ---------- Email frequency (legacy, used by settings page) ----------

export const EMAIL_FREQUENCIES: readonly { value: EmailFrequency; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "never", label: "Never" },
] as const;
