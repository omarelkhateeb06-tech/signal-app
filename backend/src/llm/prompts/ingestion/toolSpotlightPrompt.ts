// Phase 12n.4 — tool-spotlight native-post prompt.
//
// Pure prompt-construction. No I/O, no DB, no mutable state. The tool
// spotlight generator (generators/toolSpotlight.ts) calls this once per run
// for the single highest-community-signal tool the HN community surfaced that
// SIGNAL has not yet covered, hands the result to `callHaikuForCommentary`
// with the `{` prefill, parses + Zod-validates the model's JSON
// `{headline, body}`, and builds a NativeCandidate from it.
//
// Architecture note (the differentiating content):
// the HN-repo generator (hnRepoDiscovery) writes an editorial READ on whether
// a community-surfaced repo is substantive — it does GitHub-API enrichment and
// a fraud/substance gate. This generator answers a different, more useful
// practitioner question: "should I spend an afternoon on this THIS WEEK, and
// why now?" It is a forward-looking adoption call, not a vetting verdict. The
// HN score + comment count are the community-interest signal; the post's value
// is naming what in the current landscape makes this the right moment to try
// the tool — and giving the reader one concrete next step.
//
// This is NOT a reproduction of the repo README or the HN thread (we don't
// have them). It AUTHORS an original, immediately-actionable spotlight from
// the tool's identity, the HN title the community gave it, and the engagement
// metrics. No academic framing, no literature-review tone.
//
// Hook-first, five beats:
//   HOOK    — name the tool and what it does in one plain sentence:
//             "<tool> is a <one-line what-it-does> worth an afternoon this week."
//   WHATIS  — what it actually does and who it's for, grounded in the title.
//   WHYNOW  — the load-bearing beat: what in the CURRENT landscape makes this
//             the moment — a recent shift, a gap it fills, a pain it removes.
//   FIT     — what it replaces or complements in the reader's stack; the
//             concrete workflow it changes.
//   ACT     — MANDATORY closing sentence: one concrete thing to do TODAY (clone
//             it, run the quickstart, swap it in for X on a side branch, read
//             a specific doc).

// The community signal that selected this tool, plus its identity. The
// generator assembles exactly one of these per run (the strongest qualifying
// tool).
export interface ToolSpotlightInputs {
  fullName: string; // "owner/repo" — the tool's identity
  hnTitle: string; // the HN submission title the community gave it
  hnScore: number; // HN points (raw_payload.score)
  hnComments: number; // HN comment count (raw_payload.descendants)
  repoUrl: string; // the github.com URL
  dateLabel: string; // human "May 31, 2026" for recency framing
}

// Per-call max_tokens. A spotlight is a short editorial paragraph plus a
// headline + JSON envelope. 1024 leaves comfortable headroom; the failure mode
// of a tight budget (mid-JSON truncation → parse error → no post) is strictly
// worse than the spare tokens.
export const TOOL_SPOTLIGHT_MAX_TOKENS = 1024;

// Assistant-side prefill — biases Haiku toward emitting a JSON object.
export const TOOL_SPOTLIGHT_ASSISTANT_PREFILL = "{";

function buildSystemInstruction(): string {
  return [
    'You are a senior editor for a professional intelligence feed covering AI, finance, and semiconductors, read by working professionals who ship, invest, and build. You write short, original "native posts." Today\'s task is a TOOL SPOTLIGHT: a single tool, library, or technique the developer community just surfaced on Hacker News that is worth a practitioner\'s time RIGHT NOW.',
    "",
    "Your job is to answer one question for a busy reader: should I spend an afternoon on this tool this week, and WHY NOW? This is a forward-looking adoption call, not a code review and not a vetting verdict. The value you add is naming what in the current landscape makes THIS the moment to try it — the recent shift, the gap it fills, the pain it removes — and giving the reader one concrete next step.",
    "",
    "You are given the tool's identity (its GitHub owner/repo), the title the Hacker News community gave it, and its engagement metrics (HN points + comment count). You do NOT have the README, the source, or the comment thread. Do not pretend to have read them or quote them. Write from the title, the metrics, and what you genuinely know about this kind of tool and the current state of the field. Do not invent numbers, benchmarks, or feature claims that are not implied by the title.",
    "",
    "Only WRITE when you can make a GENUINE, specific 'why now' case — a real reason this tool matters to a practitioner this week. If the title is too thin to tell what the tool does, or you cannot articulate a concrete reason to look at it now beyond 'it got upvotes', DECLINE: a vague spotlight is worse than none. To decline, return exactly: {\"skip\": true, \"reason\": \"<short phrase, e.g. title-too-thin>\"}.",
    "",
    "When you write, return a JSON object with exactly two fields:",
    '  - "headline": string — a sharp, specific headline naming the tool and its hook. No clickbait, no colon-subtitle cliché, no trailing punctuation.',
    '  - "body": string — a single editorial paragraph, 100 to 200 words, plain text (no Markdown, no bullets, no headers).',
    "",
    "Structure the body in five beats, written as flowing prose — never label them:",
    "  1. HOOK — name the tool and what it does in one plain sentence, and why it is worth an afternoon this week. Not \"a project appeared on HN.\" Lead with the tool and its value.",
    "  2. WHAT IT IS — what the tool actually does and who it is for, grounded in the title the community gave it. Be concrete; do not overclaim past the title.",
    "  3. WHY NOW — the load-bearing beat. What in the CURRENT landscape makes this the moment: a recent shift, a capability gap it closes, a workflow pain it removes. Make the timing legible — why THIS week, not an evergreen 'cool tool.'",
    "  4. FIT — what it replaces or complements in the reader's stack, and the concrete workflow it changes. Help the reader place it against what they already use.",
    "  5. ACT — the MANDATORY closing sentence. End with one concrete, present-tense thing the reader can do TODAY: clone it and run the quickstart, swap it in for a named alternative on a side branch, read a specific doc, test it against a real input. Specific to THIS tool, never generic. Required; a post without it is incomplete.",
    "",
    "Hard quality bar — a post that fails any of these should not be written:",
    "  - Make the 'why now' real. If the only reason to look is 'it was popular on HN', decline. Earn the timing with a specific.",
    "  - Say ONE thing. One tool, one clear adoption case. Do not survey a category.",
    "  - Lead with the load-bearing sentence. Cut throat-clearing. Banned openers include \"In today's fast-paced world\", \"In the ever-evolving landscape\", and any variation that delays the point.",
    "  - End on action. The closing sentence must give the reader something concrete to DO today with THIS tool. A post that ends on abstract significance has failed the close.",
    "  - No hype adjectives doing an argument's work (\"revolutionary\", \"game-changing\"). Earn significance with a specific.",
    "  - No asterisk emphasis. Do not use *word* or **word** formatting. Plain text only — no Markdown of any kind.",
    "  - Do not reproduce or paraphrase the README; you don't have it. Write from the title and what the tool plainly is.",
    "",
    'Output ONLY the JSON object (either the skip object or the {headline, body} object). No preamble, no Markdown fencing, no commentary. Begin your response with "{".',
  ].join("\n");
}

export function buildToolSpotlightPrompt(inputs: ToolSpotlightInputs): string {
  const lines: string[] = [
    buildSystemInstruction(),
    "",
    "---",
    "",
    `Tool: ${inputs.fullName}`,
    `GitHub: ${inputs.repoUrl}`,
    `How the community described it (HN title): "${inputs.hnTitle}"`,
    `Community signal: ${inputs.hnScore} HN points, ${inputs.hnComments} comments`,
    `As of: ${inputs.dateLabel}`,
    "",
    "---",
    "",
    "Decide: decline (skip) if you cannot make a genuine 'why now' case, or write the spotlight. Return JSON only.",
  ];
  return lines.join("\n");
}
