// Phase 12n.2 — GitHub-trending native-post prompt builder.
//
// Pure prompt-construction. No I/O, no DB, no mutable state. The GitHub
// trending generator (generators/githubTrending.ts) calls this once per
// selected repo, hands the result to `callHaikuForCommentary` with the
// `{` prefill, parses + Zod-validates the model's JSON `{headline, body}`,
// and builds a NativeCandidate from it.
//
// This is NOT fact extraction or commentary on someone else's article —
// it AUTHORS an original editorial post about a public artifact (a
// trending GitHub repo) from the repo's own API metadata. No README
// scraping, no third-party prose reproduced: the model is fed only the
// structured signals (name, description, stars, velocity, language,
// topics) and asked to synthesize the one non-obvious thing that matters.
//
// Treatment 1 — hook-first, four beats:
//   HOOK      — lead with the surprising/load-bearing fact, not setup.
//   SPECIFICS — the concrete numbers that make the hook real.
//   STAKES    — why an AI professional should care (the non-obvious
//               connection — what this signals about where the field is
//               moving, not a restatement of the repo's tagline).
//   SOURCE    — name the repo plainly so the post is honestly sourced.
//
// Quality bar baked into the system instruction (the 12n.2 gate):
//   - Say ONE thing. A native post that makes three half-points makes
//     none.
//   - Cut to the load-bearing sentence. No throat-clearing, no "in
//     today's fast-paced world."
//   - Ship only the non-obvious connection. If the post just restates
//     the repo description in fancier words, it should not exist.

export interface GithubNativeInputs {
  // Repo identity.
  fullName: string; // e.g. "owner/repo"
  description: string | null;
  // Quantitative signals — the SPECIFICS beat draws from these.
  stars: number;
  starVelocityPerDay: number; // computed by the generator
  // Substance signals — the model uses these to sanity-check whether the
  // star count is backed by real adoption or is likely manipulated.
  forks: number;
  openIssues: number;
  contributors: number;
  corroborated: boolean; // true if a Hacker News story links this repo
  primaryLanguage: string | null;
  topics: string[];
  createdAt: string; // ISO — lets the model frame "X stars in Y days"
  pushedAt: string; // ISO — recency signal
}

// Per-call max_tokens. A native post is a short editorial paragraph
// (~120–180 words) plus a headline + JSON envelope. ~180 words ×
// ~1.4 tokens/word + envelope ≈ 320 tokens; 1024 is comfortable
// headroom and the failure mode of a tight budget (mid-JSON truncation
// → parse error → repo skipped) is strictly worse than the spare tokens.
export const GITHUB_NATIVE_MAX_TOKENS = 1024;

// Assistant-side prefill — biases Haiku toward emitting a JSON object.
// `callHaikuForCommentary` re-attaches the prefill to the returned text
// so downstream JSON.parse sees the full payload.
export const GITHUB_NATIVE_ASSISTANT_PREFILL = "{";

const SYSTEM_INSTRUCTION = [
  "You are a senior editor for a professional intelligence feed read by AI researchers, engineers, and investors. You write short, original \"native posts\" — editorial takes on a single public signal. Today's signal is a GitHub repository that is trending fast.",
  "",
  "You are given the repository's public API metadata only: its name, one-line description, star count, how fast it is gaining stars, fork count, open-issue count, contributor count, whether Hacker News has surfaced it, its primary language, and its topic tags. You will NOT be given the README or any of the repo's prose. Do not pretend to have read the code or docs. Write only from the metadata and what you genuinely know about the space.",
  "",
  "CRITICAL — star counts are manipulable. Bot-purchased stars cost cents, so a high star count (and a high stars/day velocity) is NOT proof of significance. Before you write anything, sanity-check whether the stars are backed by real adoption. Tells of a manufactured signal: stars far outstrip forks (real users fork; bots don't); few contributors driving a supposedly-viral project; near-zero open issues despite huge stars; a thin/young repo with an implausible star explosion; a meme or joke premise; Hacker News and other signals show no corroboration. If the traction looks anomalous relative to the repo's actual substance, that is a reason to DECLINE — never manufacture significance to fill the slot. A confident, well-written post about a faked signal is worse than no post at all.",
  "",
  "You therefore have two possible responses:",
  '  A) DECLINE — if the repo does not warrant a post, return exactly: {"skip": true, "reason": "<one short phrase, e.g. stars-not-corroborated-by-forks-or-contributors>"}. This is a correct, expected outcome. Do not force a post.',
  "  B) WRITE — if and only if the signal holds up, return a JSON object with exactly two fields:",
  '       - "headline": string — a sharp, specific headline. No clickbait, no colon-subtitle cliché, no trailing punctuation. State the actual development.',
  '       - "body": string — a single editorial paragraph, 90 to 180 words, plain text (no Markdown, no bullet points, no headers).',
  "",
  "Structure the body in four beats, but write them as flowing prose — never label them:",
  "  1. HOOK — open with the single most load-bearing or surprising fact. Not setup, not background. The first sentence must earn the read.",
  "  2. SPECIFICS — ground the hook in the concrete numbers (stars, velocity, language). Use the real figures you were given.",
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

export function buildGithubNativePrompt(inputs: GithubNativeInputs): string {
  const description = inputs.description?.trim() || "(no description provided)";
  const topics =
    inputs.topics.length > 0 ? inputs.topics.join(", ") : "(none listed)";
  const language = inputs.primaryLanguage?.trim() || "(unspecified)";

  return [
    SYSTEM_INSTRUCTION,
    "",
    "---",
    "",
    "Repository metadata:",
    `  full_name: ${inputs.fullName}`,
    `  description: ${description}`,
    `  primary_language: ${language}`,
    `  topics: ${topics}`,
    `  stars: ${inputs.stars}`,
    `  star_velocity_per_day: ${inputs.starVelocityPerDay}`,
    `  forks: ${inputs.forks}`,
    `  open_issues: ${inputs.openIssues}`,
    `  contributors: ${inputs.contributors}`,
    `  hacker_news_corroboration: ${inputs.corroborated ? "yes" : "none"}`,
    `  created_at: ${inputs.createdAt}`,
    `  pushed_at: ${inputs.pushedAt}`,
    "",
    "---",
    "",
    "Decide: decline (skip) or write. Return JSON only.",
  ].join("\n");
}
