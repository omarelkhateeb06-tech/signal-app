import { Fragment, type ReactNode } from "react";

const MAX_TERMS = 10;
const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "to",
  "in",
  "on",
  "for",
  "with",
  "by",
  "at",
  "is",
  "are",
  "was",
  "were",
  "be",
  "it",
  "as",
]);

export function extractHighlightTerms(query: string): string[] {
  if (!query) return [];
  const withoutOperators = query.replace(/[-+]/g, " ");
  const phraseMatches = Array.from(withoutOperators.matchAll(/"([^"]+)"/g)).map(
    (m) => m[1],
  );
  const bare = withoutOperators.replace(/"[^"]+"/g, " ");
  const words = bare
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w.toLowerCase()));
  const unique = new Map<string, string>();
  for (const term of [...phraseMatches, ...words]) {
    const key = term.toLowerCase();
    if (!unique.has(key)) unique.set(key, term);
    if (unique.size >= MAX_TERMS) break;
  }
  return Array.from(unique.values());
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function highlightText(text: string, terms: string[]): ReactNode {
  if (!text || terms.length === 0) return text;
  const pattern = new RegExp(
    `(${terms.map(escapeRegExp).join("|")})`,
    "gi",
  );
  const lowered = new Set(terms.map((t) => t.toLowerCase()));
  const parts = text.split(pattern);
  return parts.map((part, idx) =>
    lowered.has(part.toLowerCase()) ? (
      <mark
        key={idx}
        className="rounded bg-amber-100 px-0.5 text-inherit"
      >
        {part}
      </mark>
    ) : (
      <Fragment key={idx}>{part}</Fragment>
    ),
  );
}
