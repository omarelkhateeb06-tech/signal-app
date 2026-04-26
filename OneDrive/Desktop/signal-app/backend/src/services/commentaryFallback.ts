// Phase 12c — deterministic fallback commentary.
// Phase 12d — native `{thesis, support}` shape; banned-opener regex
// gate; expanded Tier-3 reason union for JSON-shape failures.
//
// When Haiku is unreachable, times out, returns empty, fails to emit
// parseable JSON, or trips a banned-phrase / banned-opener check, we
// fall back to a locally-constructed structured commentary so the feed
// is never left with a null "why this matters". Templates are tiered
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
// Haiku output (reroute → fallback with reason="haiku_banned_phrase")
// and in the fallback templates themselves (defense-in-depth; a
// template that trips this is a code bug and logs an anomaly).
//
// Banned-opener enforcement (12d): the prompt asks the model not to
// open thesis or support with "As you …" or "For someone …". The
// regex check below is the post-generation trip-wire — positional, run
// per-field, separate from the substring banned-phrase list.
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

// 12d — banned openers (positional, per-field). The prompt forbids
// thesis/support from opening with these patronizing audience-framing
// templates; this is the post-generation trip-wire. Anchored at start
// (modulo leading whitespace), case-insensitive, and require a word
// after so we don't flag e.g. "As you've already seen" via overly
// loose matching — the `\w+` is the audience verb that makes the
// opener feel addressed-at rather than analytical.
export const BANNED_OPENERS: readonly RegExp[] = [
  /^\s*As you\s+\w+/i,
  /^\s*For someone\s+\w+/i,
] as const;

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

export interface BannedOpenerResult {
  clean: boolean;
  // Per-field offending pattern source. Empty when clean. Field names
  // match the structured commentary shape so the anomaly log can point
  // an operator at the exact field that tripped.
  offenders: { field: "thesis" | "support"; pattern: string }[];
}

/**
 * 12d — Check thesis and support openers against `BANNED_OPENERS`.
 * Independent of `checkBannedPhrases`; both run during the cache-miss
 * Haiku gate, in order (phrase first, then opener). Empty `offenders`
 * means clean; non-empty triggers a `haiku_banned_opener` fallback.
 */
export function checkBannedOpeners(commentary: {
  thesis: string;
  support: string;
}): BannedOpenerResult {
  const offenders: { field: "thesis" | "support"; pattern: string }[] = [];
  for (const pat of BANNED_OPENERS) {
    if (pat.test(commentary.thesis)) {
      offenders.push({ field: "thesis", pattern: pat.source });
    }
    if (pat.test(commentary.support)) {
      offenders.push({ field: "support", pattern: pat.source });
    }
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
  // 12d additions — JSON-shape and banned-opener gate failures.
  | "haiku_json_parse"
  | "haiku_json_shape"
  | "haiku_banned_opener"
  // Post-insert re-read came up empty — no row from onConflictDoNothing
  // and no row from the follow-up select. Unreachable under the current
  // write path (the insert either returns our row or loses to a racer
  // whose row the re-read sees); the constant exists so an anomaly log
  // on this branch reports the true cause rather than being mislabeled
  // as a banned-phrase reject.
  | "cache_race_unexpected"
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

// 12d — fallback now produces the same shape as Haiku output. Single
// data shape across the system; no first-sentence-split heuristic at
// the consumer.
export interface FallbackCommentary {
  thesis: string;
  support: string;
}

export interface FallbackResult {
  commentary: FallbackCommentary;
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
      return "engineers";
    case "researcher":
      return "researchers";
    case "manager":
      return "managers";
    case "vc":
      return "investors";
    case "analyst":
      return "analysts";
    case "founder":
      return "founders";
    case "executive":
      return "executives";
    case "student":
      return "students";
    default:
      return "anyone tracking this space";
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

// 12d — All builders return a `{thesis, support}` pair. Thesis is a
// short standalone take; support elaborates without restating. Phrasing
// is intentionally analytical, not addressed-at-reader, so the same
// banned-opener regexes that gate Haiku output don't trip these.

function buildTier1(i: FallbackInput): FallbackCommentary {
  const role = roleFragment(i.profile.role!);
  const sector = sectorLabel(i.storySector);
  const topics = topicFragment(i.matched.matchedTopics);
  return {
    thesis: `This story sits in ${sector} and touches ${topics} — areas ${role} tracking the space have flagged as relevant.`,
    support: i.storyWhyItMatters,
  };
}

function buildTier2(i: FallbackInput): FallbackCommentary {
  const role = roleFragment(i.profile.role!);
  const sector = sectorLabel(i.storySector);
  return {
    thesis: `This story is worth attention from ${role} following ${sector}.`,
    support: i.storyWhyItMatters,
  };
}

function buildTier3(i: FallbackInput): FallbackCommentary {
  // Deliberately free of profile anchors — we don't have enough to
  // pretend otherwise. Leans on the editorial why_it_matters baseline.
  const sector = sectorLabel(i.storySector);
  return {
    thesis: `Worth knowing for anyone who follows ${sector}.`,
    support: i.storyWhyItMatters,
  };
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
 * Build a fallback `{thesis, support}` plus tier metadata. The result
 * is always safe to serve — the function sanitizes its own output
 * against the banned-phrase list, swapping matches for neutral
 * synonyms so the user never sees placeholder text or a blank card.
 *
 * Tier selection:
 *   - Haiku failure reason supplied         → tier3 (anomaly)
 *   - profile missing role/domain/seniority → tier3 (anomaly)
 *   - story sector not in user's sectors    → tier3 (anomaly, "off_sector")
 *   - else matched topics > 0               → tier1
 *   - else                                  → tier2
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

  let commentary =
    tier === "tier1"
      ? buildTier1(input)
      : tier === "tier2"
        ? buildTier2(input)
        : buildTier3(input);

  // Defense-in-depth: the template strings above are human-reviewed,
  // but a future edit could slip in a banned phrase. We check both
  // fields and surgically replace — the output is still useful, and
  // the anomaly log tells an operator to fix the template.
  const combined = `${commentary.thesis}\n${commentary.support}`;
  const banCheck = checkBannedPhrases(combined);
  if (!banCheck.clean) {
    commentary = {
      thesis: scrubBannedPhrases(commentary.thesis),
      support: scrubBannedPhrases(commentary.support),
    };
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

  return { commentary, tier, anomaly };
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
