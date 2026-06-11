// Phase 12 ingestion Tier 2 — YouTube/podcast transcript dispatch prompt.
//
// Pure prompt-construction. No I/O, no DB, no mutable state. The YouTube
// transcript generators (generators/youtubeTranscript.ts) call this once per
// qualifying episode, hand the result to `callHaikuForCommentary` with the
// `{` prefill, parse + Zod-validate the model's JSON `{headline, body}`, and
// build a NativeCandidate from it.
//
// Editorial shape: a DISPATCH — "what was said + why it matters." We never
// post the raw transcript; the post is an original brief a busy professional
// reads in 40 seconds instead of watching the hour. Two material modes:
//   - WITH transcript excerpt: the model grounds every claim in what was
//     actually said and may use AT MOST one short direct quote.
//   - description-only (captions unavailable): the model writes only what the
//     episode description supports, and DECLINES when that is too thin —
//     a vague "they discussed AI" post is worse than none.
//
// Hook-first, five beats (flowing prose, never labeled):
//   HOOK      — the single most consequential thing said (claim, number,
//               bet, admission), attributed to who said it.
//   CONTEXT   — the show and conversation framing, one clause.
//   SUBSTANCE — two or three concrete specifics from the conversation.
//   WHY IT MATTERS — the practitioner takeaway for the sector.
//   POINTER   — close by naming where the full conversation is.

// One qualifying episode's inputs. The generator assembles exactly one of
// these per run (the newest qualifying unposted upload).
export interface YouTubeDispatchInputs {
  channelName: string; // "Dwarkesh Patel"
  sectorLabel: string; // "AI" | "finance" | "semiconductors" — framing only
  videoTitle: string;
  videoUrl: string;
  publishedLabel: string; // human "June 9, 2026"
  durationLabel: string; // human "1h 42m"
  description: string; // episode description (clipped)
  // Clipped caption text when timedtext yielded one; null = description-only
  // mode. The prompt language branches on this.
  transcriptExcerpt: string | null;
}

// A dispatch is a short editorial paragraph plus headline + JSON envelope.
// 1024 leaves comfortable headroom; a tight budget's failure mode (mid-JSON
// truncation → parse error → no post) is strictly worse than spare tokens.
export const YOUTUBE_DISPATCH_MAX_TOKENS = 1024;

// Assistant-side prefill — biases Haiku toward emitting a JSON object.
export const YOUTUBE_DISPATCH_ASSISTANT_PREFILL = "{";

function buildSystemInstruction(hasTranscript: boolean): string {
  const grounding = hasTranscript
    ? [
        "You are given an excerpt of the episode's actual captions plus the episode description. Ground every claim in what was actually said in the excerpt. You may use AT MOST one short direct quote (under 20 words) when a speaker's exact phrasing carries the point. Do not attribute to a speaker anything the excerpt does not support.",
      ]
    : [
        "Captions are unavailable for this episode — you have ONLY the episode description and title. Write strictly from what they support: name the guest and the stated topics, but do NOT invent claims, numbers, or quotes the description does not contain. If the description is too thin to say something concrete about what the conversation covers and why it matters, DECLINE.",
      ];

  return [
    "You are a senior editor for a professional intelligence feed covering AI, finance, and semiconductors, read by working professionals who ship, invest, and build. You write short, original \"native posts.\" Today's task is an episode DISPATCH: a long-form conversation (podcast / YouTube) just published, and your job is to tell a busy reader what was actually said and why it matters — a 40-second read that stands in for the hour they don't have.",
    "",
    ...grounding,
    "",
    'Only WRITE when you can name something concrete and consequential from the episode — a claim, a number, a bet, a disagreement, an admission. If you cannot, DECLINE: return exactly {"skip": true, "reason": "<short phrase, e.g. description-too-thin>"}.',
    "",
    "When you write, return a JSON object with exactly two fields:",
    '  - "headline": string — sharp and specific, naming the speaker/show and the consequential thing said. No clickbait, no colon-subtitle cliché, no trailing punctuation.',
    '  - "body": string — a single editorial paragraph, 120 to 220 words, plain text (no Markdown, no bullets, no headers).',
    "",
    "Structure the body in five beats, written as flowing prose — never label them:",
    "  1. HOOK — open with the single most consequential thing said, attributed to who said it. Not \"a new episode dropped.\" Lead with the claim.",
    "  2. CONTEXT — the show and the conversation's framing in one clause, woven in (who is talking to whom, about what).",
    "  3. SUBSTANCE — two or three concrete specifics from the conversation: arguments made, numbers given, positions staked out, disagreements.",
    "  4. WHY IT MATTERS — the load-bearing beat: what a working professional in this sector should take from it — what it changes, confirms, or challenges.",
    "  5. POINTER — close with one sentence naming where the full conversation is (the show), so the reader who wants depth knows where to go.",
    "",
    "Hard quality bar — a post that fails any of these should not be written:",
    "  - Say ONE thing. The episode covered many topics; pick the most consequential thread and commit to it. Do not write a table of contents.",
    "  - Attribute. Every claim belongs to a named speaker or the show; never launder a guest's claim into a fact.",
    "  - Lead with the load-bearing sentence. Cut throat-clearing. Banned openers include \"In today's fast-paced world\", \"In the ever-evolving landscape\", and any variation that delays the point.",
    '  - No hype adjectives doing an argument\'s work ("revolutionary", "game-changing"). Earn significance with a specific.',
    "  - No asterisk emphasis. Do not use *word* or **word** formatting. Plain text only — no Markdown of any kind.",
    "",
    'Output ONLY the JSON object (either the skip object or the {headline, body} object). No preamble, no Markdown fencing, no commentary. Begin your response with "{".',
  ].join("\n");
}

export function buildYouTubeDispatchPrompt(inputs: YouTubeDispatchInputs): string {
  const lines: string[] = [
    buildSystemInstruction(inputs.transcriptExcerpt !== null),
    "",
    "---",
    "",
    `Show / channel: ${inputs.channelName} (${inputs.sectorLabel} coverage)`,
    `Episode: "${inputs.videoTitle}"`,
    `Published: ${inputs.publishedLabel} · Length: ${inputs.durationLabel}`,
    `Link: ${inputs.videoUrl}`,
    "",
    "Episode description:",
    inputs.description || "(none provided)",
  ];
  if (inputs.transcriptExcerpt !== null) {
    lines.push(
      "",
      "Caption excerpt (auto-generated; may contain transcription noise):",
      inputs.transcriptExcerpt,
    );
  }
  lines.push(
    "",
    "---",
    "",
    "Decide: decline (skip) if you cannot name something concrete and consequential, or write the dispatch. Return JSON only.",
  );
  return lines.join("\n");
}
