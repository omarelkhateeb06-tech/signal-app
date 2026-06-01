// Phase 12n.x — arXiv weekly-synthesis native-post prompt.
//
// Pure prompt-construction. No I/O, no DB, no mutable state. The arXiv
// synthesis generator (generators/arxivSynthesis.ts) calls this once per
// qualifying sector per run, hands the result to `callHaikuForCommentary`
// with the `{` prefill, parses + Zod-validates the model's JSON
// `{headline, body}`, and builds a NativeCandidate from it.
//
// Architecture note (why this is SYNTHESIS, not per-paper):
// the editorial value of a research-feed post is the curator's judgment
// about what the WEEK meant — the direction the field moved — not a list of
// paper summaries. Each paper already shipped as its own ingested event with
// its own commentary; re-summarizing them one-by-one adds nothing. So this
// prompt is fed the distilled `accessible` thesis of up to five of the
// week's papers and asked to name the PATTERN across them: the non-obvious
// through-line a practitioner would otherwise miss.
//
// This is NOT fact extraction and NOT a reproduction of paper abstracts —
// it AUTHORS an original editorial paragraph from theses SIGNAL already
// generated. No arXiv prose is reproduced.
//
// Treatment 2 (12n.4 rewrite) — hook-first, five beats. Reframed from
// "what moved in research this week" toward "what moved, why it matters for
// your stack/career today, and what you can do with it." Written for a
// working professional deciding where to spend attention — NOT an academic
// reviewer cataloguing the literature:
//   HOOK      — lead with the through-line: "the week's <sector> research
//               converged on <theme> — <specific, slightly counterintuitive
//               finding>." Not "here are N papers."
//   SPECIFICS — 2-3 papers grounding the theme, each with its concrete
//               finding. Real titles, real distilled claims.
//   STAKES    — why a practitioner should reposition attention: what the
//               pattern signals about where the field is heading. Where it's
//               natural (not forced), flag the CROSS-SECTOR consequence — a
//               result that cuts inference cost is also a chip-demand and a
//               margins signal.
//   SOURCE    — "Synthesized from N arXiv papers, week of <week>."
//   ACT       — MANDATORY closing sentence: one concrete, present-tense thing
//               the reader can do TODAY (try, read, reprioritize, watch).

import type { Sector } from "../../../jobs/ingestion/relevanceSeam";

// One paper's distilled signal — the already-generated `accessible` thesis
// plus identity. The generator assembles up to 5 of these per sector.
export interface ArxivPaperInput {
  title: string;
  accessibleThesis: string; // events.why_it_matters_template.accessible.thesis
  publishedAt: string | null; // ISO date, for recency framing
}

export interface ArxivSynthesisInputs {
  sector: Sector;
  isoWeek: string; // e.g. "2026-W22"
  weekLabel: string; // human "week of May 25, 2026" for the SOURCE beat
  paperCount: number; // total qualifying papers in the window (≥ inputs.length)
  papers: ArxivPaperInput[]; // up to 5, newest first
}

// Per-call max_tokens. A synthesis post is a short editorial paragraph
// (~120–200 words) plus a headline + JSON envelope. 1024 leaves comfortable
// headroom; the failure mode of a tight budget (mid-JSON truncation → parse
// error → no post) is strictly worse than the spare tokens.
export const ARXIV_SYNTHESIS_MAX_TOKENS = 1024;

// Assistant-side prefill — biases Haiku toward emitting a JSON object.
export const ARXIV_SYNTHESIS_ASSISTANT_PREFILL = "{";

const SECTOR_LABEL: Record<Sector, string> = {
  ai: "AI / machine-learning",
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
    `You are a senior editor for a professional intelligence feed read by ${SECTOR_AUDIENCE[sector]}. You write short, original "native posts" — editorial syntheses of a week's signal. Today's signal is a set of ${SECTOR_LABEL[sector]} research papers that SIGNAL ingested from arXiv this week, each already distilled to a one-sentence "why it matters" thesis.`,
    "",
    "Write for a working professional deciding where to spend their attention this week — someone who ships, invests, or builds — NOT for an academic reviewer cataloguing the literature. The test of a good post is not \"did it summarize the research\" but \"does the reader now know something they can use.\"",
    "",
    "Your job is NOT to summarize the papers one by one. The reader can read a list of titles themselves. Your job is to identify the PATTERN — the direction the week's research points, the non-obvious through-line connecting several of these papers — and then make it matter to the reader's actual work. \"What theme is emerging, and what does it change for me?\" is the whole editorial value. If three papers independently attack the same bottleneck, that convergence IS the story.",
    "",
    "You are given each paper's title and its distilled accessible thesis only — NOT the full abstract, the methods, or the results tables. Do not pretend to have read the papers. Write from the theses and what you genuinely know about the field. Do not invent numbers that are not in the theses.",
    "",
    "Most weeks there is a real through-line and you should WRITE. Only DECLINE if the papers are so disparate that any claimed theme would be manufactured — a forced synthesis is worse than none. To decline, return exactly: {\"skip\": true, \"reason\": \"<short phrase, e.g. no-coherent-theme>\"}. Declining should be rare.",
    "",
    "When you write, return a JSON object with exactly two fields:",
    '  - "headline": string — a sharp, specific headline naming the theme. No clickbait, no colon-subtitle cliché, no trailing punctuation.',
    '  - "body": string — a single editorial paragraph, 100 to 200 words, plain text (no Markdown, no bullets, no headers).',
    "",
    "Structure the body in five beats, written as flowing prose — never label them:",
    "  1. HOOK — open with the through-line and the single most load-bearing or counterintuitive finding. Not \"this week saw several papers.\" Name the theme in the first sentence.",
    "  2. SPECIFICS — ground the theme in 2-3 of the actual papers, each with its concrete finding. Use the real titles and distilled claims you were given.",
    "  3. STAKES — the non-obvious consequence: what this convergence signals about where the field is moving, or why a practitioner should reposition attention. Where it is genuinely natural — never forced — flag the cross-sector angle: a result that cuts inference cost is also a chip-demand signal and a margins signal; name that second-order consequence in one clause.",
    "  4. SOURCE — name the basis plainly: \"Synthesized from N arXiv papers, week of <week>.\"",
    "  5. ACT — the MANDATORY closing sentence. End with one concrete, present-tense action the reader can take TODAY: a technique to try, a benchmark to read, an assumption to re-examine, a metric to start watching. It must be specific to THIS week's theme — not generic advice like \"stay informed.\" This sentence is required; a post without it is incomplete.",
    "",
    "Hard quality bar — a post that fails any of these should not be written:",
    "  - Say ONE thing. One clear thesis about the week, defended. A post that names three unrelated themes names none.",
    "  - Lead with the load-bearing sentence. Cut every word of throat-clearing. Banned openers include \"In today's fast-paced world\", \"In the ever-evolving landscape\", and any variation that delays the point.",
    "  - Surface the NON-OBVIOUS connection. If the body merely lists what each paper said, you have failed. Tell the reader what the SET means together.",
    "  - End on action. The closing sentence must give the reader something to DO today, drawn from this week's specific theme. A post that ends on abstract significance has failed the close.",
    "  - No hype adjectives doing an argument's work (\"revolutionary\", \"groundbreaking\"). Earn significance with a specific.",
    "",
    'Output ONLY the JSON object (either the skip object or the {headline, body} object). No preamble, no Markdown fencing, no commentary. Begin your response with "{".',
  ].join("\n");

export function buildArxivSynthesisPrompt(inputs: ArxivSynthesisInputs): string {
  const lines: string[] = [
    SYSTEM_INSTRUCTION(inputs.sector),
    "",
    "---",
    "",
    `Sector: ${SECTOR_LABEL[inputs.sector]}`,
    `Week: ${inputs.weekLabel} (${inputs.isoWeek})`,
    `Total qualifying papers this week: ${inputs.paperCount}`,
    "",
    `The week's papers (showing ${inputs.papers.length}, newest first):`,
  ];
  inputs.papers.forEach((p, i) => {
    lines.push(
      `  ${i + 1}. "${p.title}"${p.publishedAt ? ` (${p.publishedAt.slice(0, 10)})` : ""}`,
    );
    lines.push(`     why it matters: ${p.accessibleThesis}`);
  });
  lines.push(
    "",
    "---",
    "",
    "Decide: decline (skip) or write the synthesis. Return JSON only.",
  );
  return lines.join("\n");
}
