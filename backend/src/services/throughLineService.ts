// "The Through-Line" service — pure prompt-builder + client caller.
//
// `generateThroughLine` takes the day's top stories and the reader's
// profile, builds the editorial-synthesis prompt, calls the Haiku
// client, scrubs any banned phrase from the result, and returns the
// string — or `null` on any client-side failure. No DB, no Redis, no
// I/O beyond the injected client; the controller owns caching and the
// tier gate.

import { scrubBannedPhrasesPublic } from "./commentaryFallback";
import {
  callHaikuForThroughLine,
  type ThroughLineClientDeps,
} from "./throughLineClient";

export interface ThroughLineStory {
  headline: string;
  // One-line gist — generic_commentary preferred, why_it_matters
  // fallback. The controller resolves this before handing it over.
  gist: string;
}

export interface ThroughLineProfile {
  role: string | null;
  domain: string | null;
  seniority: string | null;
  sectors: string[] | null;
  goals: string[] | null;
}

export interface GenerateThroughLineInput {
  stories: ThroughLineStory[];
  profile: ThroughLineProfile;
}

export interface ThroughLineServiceDeps {
  client?: ThroughLineClientDeps;
}

// The SIGNAL editorial voice — calm, authoritative, specific. An editor
// who sees the connection others miss. No hype; the banned-phrase list
// from the commentary path is named here as Layer 1 (the post-gen scrub
// in the service is Layer 3).
export const THROUGH_LINE_SYSTEM_PROMPT = [
  "You are the senior editor of SIGNAL, an intelligence product for professionals following AI, finance, and semiconductors.",
  "Your voice is calm, authoritative, and specific. You see the connections others miss and state them plainly.",
  "You never hype. Avoid these phrases entirely: game-changing, revolutionary, groundbreaking, cutting-edge, paradigm shift, unprecedented, seismic shift, transformative breakthrough, rapidly changing landscape.",
  'Lead with the claim. Never open with scene-setting or throat-clearing like "The infrastructure..." — the first words must be the point.',
  "Write in plain, confident English. No preamble, no hedging, no restating the question.",
].join(" ");

/**
 * Build the user prompt from the reader's profile and the day's top
 * stories. Exported for unit testing the prompt shape independently of
 * the client call.
 */
export function buildThroughLineUserPrompt(input: GenerateThroughLineInput): string {
  const { profile, stories } = input;

  const profileLines: string[] = [];
  if (profile.role) profileLines.push(`Role: ${profile.role}`);
  if (profile.seniority) profileLines.push(`Seniority: ${profile.seniority}`);
  if (profile.domain) profileLines.push(`Domain: ${profile.domain}`);
  if (profile.sectors && profile.sectors.length > 0) {
    profileLines.push(`Sectors followed: ${profile.sectors.join(", ")}`);
  }
  if (profile.goals && profile.goals.length > 0) {
    profileLines.push(`Goals: ${profile.goals.join(", ")}`);
  }
  const profileBlock =
    profileLines.length > 0
      ? profileLines.join("\n")
      : "(no profile details on file)";

  const storyBlock = stories
    .map((s, i) => `${i + 1}. ${s.headline} — ${s.gist}`)
    .join("\n");

  return [
    "THE READER:",
    profileBlock,
    "",
    "TODAY'S TOP STORIES:",
    storyBlock,
    "",
    'Write "The Through-Line" in exactly TWO parts separated by a single newline:',
    "PART 1 — the thesis: one declarative sentence, max 14 words, naming the single connection across today's stories. Write it like a headline. No hedging, no scene-setting.",
    "PART 2 — the stakes: one sentence, max 28 words, on why that connection matters specifically to this reader given their role and goals.",
    "Output only those two lines. Do not list the stories back; do not add a greeting or sign-off.",
  ].join("\n");
}

/**
 * Generate the Through-Line. Returns the scrubbed synthesis string, or
 * `null` when the client fails (timeout, empty, api_error, no_api_key).
 * Never throws.
 */
export async function generateThroughLine(
  input: GenerateThroughLineInput,
  deps: ThroughLineServiceDeps = {},
): Promise<string | null> {
  if (input.stories.length === 0) return null;

  const userPrompt = buildThroughLineUserPrompt(input);
  const result = await callHaikuForThroughLine(
    THROUGH_LINE_SYSTEM_PROMPT,
    userPrompt,
    deps.client,
  );

  if (!result.ok) return null;

  // Layer 3 — scrub any banned phrase that slipped through the prompt
  // instruction. Reuses the commentary path's scrubber so the synonym
  // table stays single-sourced.
  const scrubbed = scrubBannedPhrasesPublic(result.text).trim();
  return scrubbed.length > 0 ? scrubbed : null;
}
