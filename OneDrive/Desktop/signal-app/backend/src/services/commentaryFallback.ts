// Phase 12c — deterministic fallback commentary.
//
// When Haiku is unreachable, times out, returns empty, or emits banned
// clichés, we fall back to a locally-constructed template so the feed
// is never left with a null "why this matters". The template is tiered
// by how much personalization context is available:
//
//   Tier 1 — role + sector match + at least one matched topic.
//            Named profile anchor + concrete topic callout.
//   Tier 2 — role + sector match but no matched topics
//            (user picked Skip on topics, or no overlap in-sector).
//            Named profile anchor, sector-level framing only.
//   Tier 3 — profile is incomplete OR the story is off-sector for the
//            user. Generic framing + anomaly log: in a normal post-
//            onboarding flow every user has role/domain/seniority, so
//            landing in Tier 3 usually means a data problem worth
//            looking at (unsubscribe-only rows, dev seed data, etc.).
//
// Banned-phrase enforcement: we reject a short list of well-known
// commentary clichés ("game-changing", "revolutionary", etc.) both in
// Haiku output (reroute → fallback with reason="banned_phrase") and in
// the fallback templates themselves (defense-in-depth; a template that
// trips this is a code bug and logs an anomaly).
//
// Pure module — no DB, no I/O. Structured-log emission is done through
// a caller-supplied logger so tests don't need to monkeypatch console.

import type { MatchedInterests } from "../utils/matchedInterests";

// Word-boundary regexes — we reject "revolutionary" as a cliché but
// tolerate "evolutionary" (no false positive for the shared stem).
// Matched case-insensitively; tested via .test(text.toLowerCase()).
//
// CONTENT DECISION — REVIEW BEFORE MERGE. This list was assembled from
// the most frequent offenders in the Phase 12a regeneration script
// output, plus canonical trade-press clichés. Tune in 12c.1 against a
// real-world sample; the list is intentionally small and conservative
// so we don't over-reject legitimate Haiku output.
export const BANNED_PHRASES: readonly string[] = [
  "game-changing",
  "game changing",
  "game-changer",
  "revolutionary",
  "revolutionize",
  "groundbreaking",
  "cutting-edge",
  "paradigm shift",
  "unprecedented",
  "rapidly changing landscape",
  "seismic shift",
  "transformative breakthrough",
] as const;

const BANNED_PATTERNS: readonly RegExp[] = BANNED_PHRASES.map(
  (p) => new RegExp(`\\b${p.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "i"),
);

export interface BannedPhraseResult {
  clean: boolean;
  offenders: string[];
}

/**
 * Check `text` against the banned-phrase list. Returns `clean: true`
 * and `offenders: []` for acceptable output; `clean: false` plus the
 * list of matched phrases (lowercased, as declared in BANNED_PHRASES)
 * when any hit. The caller decides what to do with the result — Haiku
 * hits reroute to fallback; template hits log an anomaly and we strip
 * the offender by replacing with a neutral synonym at build time.
 */
export function checkBannedPhrases(text: string): BannedPhraseResult {
  const offenders: string[] = [];
  for (let i = 0; i < BANNED_PATTERNS.length; i++) {
    const pat = BANNED_PATTERNS[i]!;
    if (pat.test(text)) offenders.push(BANNED_PHRASES[i]!);
  }
  return { clean: offenders.length === 0, offenders };
}

export type FallbackTier = "tier1" | "tier2" | "tier3";

export type Tier3Reason =
  | "haiku_timeout"
  | "haiku_empty"
  | "haiku_api_error"
  | "haiku_no_api_key"
  | "haiku_banned_phrase"
  | "missing_profile_fields"
  | "off_sector"
  | "template_banned_phrase";

export interface FallbackInput {
  storyHeadline: string;
  storySector: string;
  storyWhyItMatters: string; // role-neutral editorial baseline (stories.why_it_matters)
  profile: {
    role: string | null;
    domain: string | null;
    seniority: string | null;
  };
  matched: MatchedInterests;
  // When the caller landed in fallback because of a Haiku-side issue,
  // propagate the reason so the Tier 3 anomaly log captures it
  // verbatim. Omitted for cache-miss-without-key / cache-hit paths.
  haikuFailureReason?: Tier3Reason;
}

export interface FallbackResult {
  text: string;
  tier: FallbackTier;
  // Populated when tier === "tier3". The service consumer emits this
  // via its structured logger exactly once per fallback invocation.
  anomaly?: Tier3Anomaly;
}

export interface Tier3Anomaly {
  event: "commentary_tier3_fallback";
  reason: Tier3Reason;
  missingProfileFields?: readonly ("role" | "domain" | "seniority")[];
  // Populated when a template string itself trips banned-phrase check
  // — this is a code bug, not a user-data issue.
  templateOffenders?: readonly string[];
}

// Human-readable fragments used in templates. Kept separate from the
// template assembly so the same phrase can be reused across tiers.
const SECTOR_LABEL: Record<string, string> = {
  ai: "the AI industry",
  finance: "global finance",
  semiconductors: "the semiconductor industry",
};

function sectorLabel(sector: string): string {
  return SECTOR_LABEL[sector] ?? sector;
}

function roleFragment(role: string): string {
  // Intentionally generic — the Tier 1/2 framing is "as an X working
  // in…" and the Haiku prompt handles the real personalization. This
  // is the failure-mode copy.
  switch (role) {
    case "engineer":
      return "As an engineer";
    case "researcher":
      return "As a researcher";
    case "manager":
      return "As a manager";
    case "vc":
      return "As an investor";
    case "analyst":
      return "As an analyst";
    case "founder":
      return "As a founder";
    case "executive":
      return "As an executive";
    case "student":
      return "As a student";
    default:
      return "For anyone tracking this space";
  }
}

function topicFragment(topics: string[]): string {
  if (topics.length === 0) return "";
  // Strip the snake_case values ("foundation_models" → "foundation
  // models"). Labels live in the frontend catalog and are not worth
  // duplicating backend-side for a fallback path.
  const display = topics.map((t) => t.replace(/_/g, " "));
  if (display.length === 1) return display[0]!;
  if (display.length === 2) return `${display[0]} and ${display[1]}`;
  return `${display.slice(0, -1).join(", ")}, and ${display[display.length - 1]}`;
}

function buildTier1(i: FallbackInput): string {
  const role = roleFragment(i.profile.role!);
  const sector = sectorLabel(i.storySector);
  const topics = topicFragment(i.matched.matchedTopics);
  // Short, concrete, no superlatives. The cliché list above would
  // catch us if we strayed.
  return `${role} tracking ${sector}, this touches ${topics} — the area you flagged as most relevant. ${i.storyWhyItMatters}`;
}

function buildTier2(i: FallbackInput): string {
  const role = roleFragment(i.profile.role!);
  const sector = sectorLabel(i.storySector);
  return `${role} following ${sector}, this is worth your attention: ${i.storyWhyItMatters}`;
}

function buildTier3(i: FallbackInput): string {
  // Deliberately free of profile anchors — we don't have enough to
  // pretend otherwise. Leans on the editorial why_it_matters baseline.
  const sector = sectorLabel(i.storySector);
  return `Worth knowing if you follow ${sector}: ${i.storyWhyItMatters}`;
}

/** Fields the Tier 1/2 templates need from a profile. */
function missingProfileFields(
  profile: FallbackInput["profile"],
): ("role" | "domain" | "seniority")[] {
  const missing: ("role" | "domain" | "seniority")[] = [];
  if (!profile.role) missing.push("role");
  if (!profile.domain) missing.push("domain");
  if (!profile.seniority) missing.push("seniority");
  return missing;
}

/**
 * Build a fallback commentary string plus tier metadata. The result is
 * always safe to serve — the function sanitizes its own output against
 * the banned-phrase list, swapping matches for neutral synonyms so the
 * user never sees placeholder text or a blank card.
 *
 * Tier selection:
 *   - profile missing role/domain/seniority → tier3 (anomaly)
 *   - or Haiku failure reason supplied       → tier3 (anomaly)
 *   - or story sector not in user's sectors  → tier3 (anomaly, "off_sector")
 *   - else matched topics > 0                → tier1
 *   - else                                   → tier2
 */
export function buildFallbackCommentary(input: FallbackInput): FallbackResult {
  const missing = missingProfileFields(input.profile);
  let tier: FallbackTier;
  let anomaly: Tier3Anomaly | undefined;

  if (input.haikuFailureReason) {
    tier = "tier3";
    anomaly = {
      event: "commentary_tier3_fallback",
      reason: input.haikuFailureReason,
    };
  } else if (missing.length > 0) {
    tier = "tier3";
    anomaly = {
      event: "commentary_tier3_fallback",
      reason: "missing_profile_fields",
      missingProfileFields: missing,
    };
  } else if (!input.matched.matchedSector) {
    tier = "tier3";
    anomaly = {
      event: "commentary_tier3_fallback",
      reason: "off_sector",
    };
  } else if (input.matched.matchedTopics.length > 0) {
    tier = "tier1";
  } else {
    tier = "tier2";
  }

  let text =
    tier === "tier1"
      ? buildTier1(input)
      : tier === "tier2"
        ? buildTier2(input)
        : buildTier3(input);

  // Defense-in-depth: the template strings above are human-reviewed,
  // but a future edit could slip in a banned phrase. We check and
  // surgically replace — the output is still useful, and the anomaly
  // log tells an operator to fix the template.
  const banCheck = checkBannedPhrases(text);
  if (!banCheck.clean) {
    text = scrubBannedPhrases(text);
    const existing = anomaly ?? {
      event: "commentary_tier3_fallback" as const,
      reason: "template_banned_phrase" as const,
    };
    anomaly = {
      ...existing,
      // If we were already tier3 for a different reason, keep the
      // original reason but flag the scrub via templateOffenders.
      templateOffenders: banCheck.offenders,
    };
    // Upgrade tier to tier3 if the scrubbing-required case wasn't
    // already tier3 — we want anomaly emission to be the signal.
    tier = "tier3";
  }

  return { text, tier, anomaly };
}

// Neutral substitutions used by the defense-in-depth scrubber. Keys
// match BANNED_PHRASES entries (lowercased) exactly.
const NEUTRAL_SWAPS: Record<string, string> = {
  "game-changing": "significant",
  "game changing": "significant",
  "game-changer": "notable development",
  revolutionary: "substantial",
  revolutionize: "reshape",
  groundbreaking: "notable",
  "cutting-edge": "current",
  "paradigm shift": "structural change",
  unprecedented: "unusual",
  "rapidly changing landscape": "shifting environment",
  "seismic shift": "major change",
  "transformative breakthrough": "important development",
};

function scrubBannedPhrases(text: string): string {
  let out = text;
  for (const phrase of BANNED_PHRASES) {
    const pat = new RegExp(`\\b${phrase.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "gi");
    out = out.replace(pat, NEUTRAL_SWAPS[phrase] ?? "");
  }
  // Collapse any double spaces left by empty-string swaps (future-proof
  // if NEUTRAL_SWAPS gains a "" entry).
  return out.replace(/\s{2,}/g, " ").trim();
}
