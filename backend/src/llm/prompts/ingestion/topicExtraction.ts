// Topic-extraction prompt — pulls canonical "In Focus" topic/entity labels
// from an event's headline + context. The topic-extraction job feeds the
// result through parseTopics and stores it on events.topics, which powers the
// In Focus chips. Pure prompt builder (no I/O), mirroring the other ingestion
// prompt modules.

export const TOPIC_EXTRACTION_MAX_TOKENS = 120;
export const TOPIC_EXTRACTION_ASSISTANT_PREFILL = "[";

// Output bounds, enforced again in parseTopics (the model is asked to honor
// them, but the parser is the guarantee).
export const MAX_TOPICS = 5;
export const MAX_TOPIC_LENGTH = 40;

export interface TopicExtractionInputs {
  headline: string;
  context: string;
  sector: string;
}

const SYSTEM = [
  "You label news events with their key topics for a professional intelligence feed covering AI, finance, and semiconductors.",
  "Extract the 2–5 most important canonical topics or named entities this event is about — the threads a reader would want to follow over time.",
  "Rules:",
  '- Return ONLY a JSON array of short strings, e.g. ["NVIDIA", "Export Controls", "HBM"]. No prose, no object, no keys.',
  '- Each topic is 1–3 words, Title Case, canonical ("NVIDIA" not "nvidia"; "Export Controls" not "the new export-control rules").',
  "- Prefer durable, recurring topics — companies, technologies, policies, people, markets — over one-off specifics.",
  "- No hashtags, no sentences, no duplicates, no trailing punctuation.",
  "- 5 topics maximum; fewer is fine when the event is narrow.",
].join("\n");

export function buildTopicExtractionPrompt(input: TopicExtractionInputs): string {
  return [
    SYSTEM,
    "",
    `Sector: ${input.sector}`,
    `Headline: ${input.headline}`,
    "",
    `Context: ${input.context}`,
    "",
    "Return the JSON array of topics now.",
  ].join("\n");
}
