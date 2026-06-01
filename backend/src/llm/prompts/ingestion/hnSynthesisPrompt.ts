// Phase 12n.x — Hacker News community-synthesis native-post prompt.
//
// Pure prompt-construction. No I/O, no DB, no mutable state. The HN
// community synthesis generator (generators/hnCommunitySynthesis.ts) calls
// this once per qualifying sector per run, hands the result to
// `callHaikuForCommentary` with the `{` prefill, parses + Zod-validates the
// model's JSON `{headline, body}`, and builds a NativeCandidate from it.
//
// Architecture note (what makes this different from the HN-repo generator):
// the HN-repo generator writes about an ARTIFACT (a repository) the
// community surfaced. This writes about the COMMUNITY ITSELF — what the
// week's high-engagement non-repo discussions reveal about where the field's
// attention, excitement, or disagreement is concentrated. The HN score is
// the vetting signal (high engagement = real interest), and a high
// comment-to-score ratio signals active DEBATE, not just approval — both are
// worth surfacing. The editorial angle is "what does the engagement pattern
// tell a practitioner," not "here's what got upvoted."
//
// This is NOT a reproduction of the linked articles or the HN comment
// threads (we don't have them) — it AUTHORS an original editorial read of
// the community's attention from thread titles + engagement metrics only.
//
// Treatment 2 (12n.4 rewrite) — hook-first, five beats. Reframed from "what
// practitioners discussed this week" toward "what the practitioner community
// is figuring out RIGHT NOW and what that means for your work." Lead with the
// dominant tension the community is wrestling with — not a tour of threads —
// and close with something to watch or try:
//   HOOK      — name the single dominant signal/tension: "The <sector>
//               community spent this week <arguing about / converging on>
//               <topic>" — the one thing they're collectively working out.
//   SPECIFICS — 2-3 threads with score + what the engagement reveals.
//   WHYNOW    — why THIS conversation is happening now: what recent shift
//               (a release, a price move, a failure) put it on the table.
//   STAKES    — what the attention pattern signals for the reader's work.
//   WATCH     — MANDATORY close: what to watch or try this week.

import type { Sector } from "../../../jobs/ingestion/relevanceSeam";

// One high-engagement thread's signal. `accessibleCommentary` is the
// resolved event's distilled thesis when the thread became an ingested event;
// null when it didn't (the title + metrics still carry the signal).
export interface HnThreadInput {
  title: string;
  score: number; // HN points (raw_payload.score)
  comments: number; // HN comment count (raw_payload.descendants)
  accessibleCommentary: string | null;
}

export interface HnSynthesisInputs {
  sector: Sector;
  isoWeek: string; // e.g. "2026-W22"
  weekLabel: string; // human "week of May 25, 2026"
  threadCount: number; // total qualifying threads (≥ threads.length)
  threads: HnThreadInput[]; // top 3-5 by score, highest first
}

export const HN_SYNTHESIS_MAX_TOKENS = 1024;
export const HN_SYNTHESIS_ASSISTANT_PREFILL = "{";

const SECTOR_LABEL: Record<Sector, string> = {
  ai: "AI",
  finance: "finance",
  semiconductors: "semiconductor",
};

const SECTOR_AUDIENCE: Record<Sector, string> = {
  ai: "AI researchers and ML engineers",
  finance: "finance and markets professionals",
  semiconductors: "semiconductor engineers and analysts",
};

const SYSTEM_INSTRUCTION = (sector: Sector): string =>
  [
    `You are a senior editor for a professional intelligence feed read by ${SECTOR_AUDIENCE[sector]}. You write short, original "native posts." Today's signal is the ${SECTOR_LABEL[sector]} community's attention this week — the non-repository discussions that drew the most engagement on Hacker News, which SIGNAL ingests.`,
    "",
    "Your job is to write about what the community is FIGURING OUT right now, not to recap what happened. Lead with the dominant signal — the one tension or question the community is collectively wrestling with this week — not a tour of separate threads. The score and comment counts are the data: a high score is broad interest; a high comment-to-score ratio is active DEBATE — the community is arguing, which means the question is unsettled. Both are worth surfacing. The editorial angle is: what does this week's engagement pattern tell the reader about where the field's excitement, anxiety, or disagreement is concentrated — and what it means for their own work?",
    "",
    "You are given each thread's title and its engagement metrics (HN points + comment count), and sometimes a one-line distilled take when the thread also became a SIGNAL story. You do NOT have the article text or the comment threads. Do not pretend to have read them or quote specific comments. Write from the titles, the metrics, and what you genuinely know about the field. Do not invent numbers beyond the metrics you were given.",
    "",
    "Most weeks there is a real pattern and you should WRITE. Only DECLINE if the threads are so unrelated that any claimed pattern would be manufactured. To decline, return exactly: {\"skip\": true, \"reason\": \"<short phrase, e.g. no-coherent-pattern>\"}. Declining should be rare.",
    "",
    "When you write, return a JSON object with exactly two fields:",
    '  - "headline": string — a sharp, specific headline naming the pattern. No clickbait, no colon-subtitle cliché, no trailing punctuation.',
    '  - "body": string — a single editorial paragraph, 100 to 200 words, plain text (no Markdown, no bullets, no headers).',
    "",
    "Structure the body in five beats, written as flowing prose — never label them:",
    "  1. HOOK — lead with the single dominant tension or question the community is working out this week, anchored to the most telling thread. Not \"this week had several discussions\" and not a list — the ONE thing they're collectively figuring out.",
    "  2. SPECIFICS — 2-3 of the actual threads with their engagement (e.g. \"X drew N points and M comments\") and what that engagement reveals.",
    "  3. WHY NOW — why this conversation is surfacing now: the recent shift that put it on the table (a release, a price move, a public failure, a regulatory move). Make the timing legible — what changed to make practitioners argue about this THIS week.",
    "  4. STAKES — the non-obvious read: what the attention pattern signals for the reader — where to point attention, what consensus is forming or breaking.",
    "  5. WATCH — the MANDATORY closing sentence. End with what to watch or try this week: the signal that would resolve the tension, the thing worth testing, or the development to track. Specific to THIS week's pattern, not generic advice. Required; a post without it is incomplete.",
    "",
    "Hard quality bar — a post that fails any of these should not be written:",
    "  - Say ONE thing. One clear read on the week's attention, defended.",
    "  - Lead with the TENSION, not a thread tour. The first sentence must name what the community is collectively working out, not introduce the list.",
    "  - Lead with the load-bearing sentence. Cut throat-clearing. Banned openers include \"In today's fast-paced world\", \"In the ever-evolving landscape\", and any variation that delays the point.",
    "  - Make the timing legible. The reader should understand why this is a THIS-WEEK conversation, not an evergreen one.",
    "  - End on something to watch or try. The closing sentence must give the reader a concrete thing to track or test this week. A post that ends on abstract significance has failed the close.",
    "  - Surface the NON-OBVIOUS read. If the body merely lists what got upvoted, you have failed. Tell the reader what the pattern MEANS.",
    "  - No hype adjectives doing an argument's work. Earn significance with a specific.",
    "",
    'Output ONLY the JSON object (either the skip object or the {headline, body} object). No preamble, no Markdown fencing, no commentary. Begin your response with "{".',
  ].join("\n");

export function buildHnSynthesisPrompt(inputs: HnSynthesisInputs): string {
  const lines: string[] = [
    SYSTEM_INSTRUCTION(inputs.sector),
    "",
    "---",
    "",
    `Sector: ${SECTOR_LABEL[inputs.sector]}`,
    `Week: ${inputs.weekLabel} (${inputs.isoWeek})`,
    `Total qualifying threads this week: ${inputs.threadCount}`,
    "",
    `The week's highest-engagement threads (showing ${inputs.threads.length}, highest score first):`,
  ];
  inputs.threads.forEach((t, i) => {
    lines.push(`  ${i + 1}. "${t.title}" — ${t.score} points, ${t.comments} comments`);
    if (t.accessibleCommentary && t.accessibleCommentary.trim().length > 0) {
      lines.push(`     SIGNAL's take: ${t.accessibleCommentary.trim()}`);
    }
  });
  lines.push(
    "",
    "---",
    "",
    "Decide: decline (skip) or write the synthesis. Return JSON only.",
  );
  return lines.join("\n");
}
