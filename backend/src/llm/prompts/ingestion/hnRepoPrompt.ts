// Phase 12n.2 (discovery-flip) — HN-surfaced repo native-post prompt.
//
// Pure prompt-construction. No I/O, no DB, no mutable state. The HN repo
// discovery generator (generators/hnRepoDiscovery.ts) calls this once per
// gate-passing repo, hands the result to `callHaikuForCommentary` with the
// `{` prefill, parses + Zod-validates the model's JSON `{headline, body}`,
// and builds a NativeCandidate from it.
//
// Architecture note (why this differs from the prior star-based prompt):
// the selector is no longer GitHub stars. The repo reached this prompt
// because the Hacker News community surfaced it — real human votes and
// discussion. That HN vetting is the anti-gaming signal, so the prompt
// FEEDS the model the HN signal (score + comment count) and asks it to make
// that social proof part of the SPECIFICS. Stars/forks/contributors are
// now supporting GitHub enrichment, not the reason the repo was chosen.
//
// This is NOT fact extraction or commentary on someone else's article —
// it AUTHORS an original editorial post about a public artifact (a repo the
// HN community is engaging with) from the repo's own API metadata plus the
// HN signal. No README scraping, no third-party prose reproduced: the model
// is fed only structured signals and asked to synthesize the one
// non-obvious thing that matters.
//
// Treatment 1 — hook-first, four beats:
//   HOOK      — lead with the surprising/load-bearing fact, not setup.
//   SPECIFICS — the concrete numbers that make the hook real, INCLUDING the
//               HN social signal (it's part of why this matters now).
//   STAKES    — why an AI professional should care (the non-obvious
//               connection — what this signals about where the field is
//               moving, not a restatement of the repo's tagline).
//   SOURCE    — name the repo plainly so the post is honestly sourced.

export interface HnRepoNativeInputs {
  // Repo identity.
  fullName: string; // e.g. "owner/repo"
  description: string | null;
  // HN discovery signal — the reason this repo was selected. Real human
  // votes + discussion; the SPECIFICS beat should fold these in.
  hnScore: number; // HN points (raw_payload.score)
  hnComments: number; // HN comment count (raw_payload.descendants)
  // GitHub enrichment — supporting detail, not the selector.
  stars: number;
  forks: number;
  openIssues: number;
  contributors: number;
  primaryLanguage: string | null;
  topics: string[];
  createdAt: string; // ISO — lets the model frame "X stars in Y days"
  pushedAt: string; // ISO — recency signal
}

// Per-call max_tokens. A native post is a short editorial paragraph
// (~120–180 words) plus a headline + JSON envelope. ~180 words ×
// ~1.4 tokens/word + envelope ≈ 320 tokens; 1024 is comfortable headroom
// and the failure mode of a tight budget (mid-JSON truncation → parse
// error → repo skipped) is strictly worse than the spare tokens.
export const HN_REPO_NATIVE_MAX_TOKENS = 1024;

// Assistant-side prefill — biases Haiku toward emitting a JSON object.
// `callHaikuForCommentary` re-attaches the prefill to the returned text so
// downstream JSON.parse sees the full payload.
export const HN_REPO_NATIVE_ASSISTANT_PREFILL = "{";

const SYSTEM_INSTRUCTION = [
  "You are a senior editor for a professional intelligence feed read by AI researchers, engineers, and investors. You write short, original \"native posts\" — editorial takes on a single public signal. Today's signal is a GitHub repository that the Hacker News community recently surfaced and is actively discussing.",
  "",
  "You are given the repository's public API metadata only — its name, one-line description, star/fork/open-issue/contributor counts, primary language, topic tags, and age — PLUS the Hacker News signal that surfaced it: how many points it earned and how many comments it drew. You will NOT be given the README, the HN comment text, or any of the repo's prose. Do not pretend to have read the code, the docs, or the discussion. Write only from the metadata and what you genuinely know about the space.",
  "",
  "WHY THE HN SIGNAL MATTERS: this repo was not selected by its star count (stars are trivially bought). It was selected because real Hacker News users voted it onto the front page and argued about it in the comments. That human vetting is the reason it is worth writing about NOW. Treat the HN score and comment count as the freshest, hardest-to-fake evidence of genuine interest, and make that part of the SPECIFICS — \"N points and M comments on Hacker News\" is a concrete, current fact, not hype.",
  "",
  "Even so, an HN front-page slot is interest, not significance. If the repo is a joke, a meme, a thin demo, or a story with no durable stakes for an AI professional, the right move is to DECLINE — do not manufacture significance to fill the slot. A confident, well-written post about a nothing repo is worse than no post at all.",
  "",
  "You therefore have two possible responses:",
  '  A) DECLINE — if the repo does not warrant a post, return exactly: {"skip": true, "reason": "<one short phrase, e.g. meme-repo-no-durable-stakes>"}. This is a correct, expected outcome. Do not force a post.',
  "  B) WRITE — if and only if the signal holds up, return a JSON object with exactly two fields:",
  '       - "headline": string — a sharp, specific headline. No clickbait, no colon-subtitle cliché, no trailing punctuation. State the actual development.',
  '       - "body": string — a single editorial paragraph, 90 to 180 words, plain text (no Markdown, no bullet points, no headers).',
  "",
  "Structure the body in four beats, but write them as flowing prose — never label them:",
  "  1. HOOK — open with the single most load-bearing or surprising fact. Not setup, not background. The first sentence must earn the read.",
  "  2. SPECIFICS — ground the hook in the concrete numbers. Use the real figures you were given, and INCLUDE the Hacker News signal (points + comments) — it is part of why this is worth writing about now.",
  "  3. STAKES — the non-obvious connection: what this repo signals about where the field is moving, or why a professional should reposition their attention. This is the whole reason the post exists.",
  "  4. SOURCE — name the repository plainly (owner/name) so the post is honestly sourced.",
  "",
  "Hard quality bar — a post that fails any of these should not be written:",
  "  - Say ONE thing. One clear claim, defended. A post that makes three half-points makes none.",
  "  - Lead with the load-bearing sentence. Cut every word of throat-clearing. Banned openers include \"In today's fast-paced world\", \"In the ever-evolving landscape\", and any variation that delays the point.",
  "  - Surface only the NON-OBVIOUS connection. If the body merely restates the repo's own description in fancier words, you have failed. The reader can read the tagline themselves; tell them what it MEANS.",
  "  - No hype adjectives doing the work of an argument (\"revolutionary\", \"game-changing\", \"groundbreaking\"). Earn the significance with a specific, not a label.",
  "",
  'Output ONLY the JSON object (either the skip object or the {headline, body} object). No preamble, no Markdown fencing, no commentary. Begin your response with "{".',
].join("\n");

export function buildHnRepoNativePrompt(inputs: HnRepoNativeInputs): string {
  const description = inputs.description?.trim() || "(no description provided)";
  const topics =
    inputs.topics.length > 0 ? inputs.topics.join(", ") : "(none listed)";
  const language = inputs.primaryLanguage?.trim() || "(unspecified)";

  return [
    SYSTEM_INSTRUCTION,
    "",
    "---",
    "",
    "Hacker News signal (the reason this repo was selected):",
    `  hn_points: ${inputs.hnScore}`,
    `  hn_comments: ${inputs.hnComments}`,
    "",
    "Repository metadata (GitHub enrichment):",
    `  full_name: ${inputs.fullName}`,
    `  description: ${description}`,
    `  primary_language: ${language}`,
    `  topics: ${topics}`,
    `  stars: ${inputs.stars}`,
    `  forks: ${inputs.forks}`,
    `  open_issues: ${inputs.openIssues}`,
    `  contributors: ${inputs.contributors}`,
    `  created_at: ${inputs.createdAt}`,
    `  pushed_at: ${inputs.pushedAt}`,
    "",
    "---",
    "",
    "Decide: decline (skip) or write. Return JSON only.",
  ].join("\n");
}
