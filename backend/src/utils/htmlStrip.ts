// HTML → plain text utility for ingestion-time normalization (Phase 12e.x).
//
// Removes HTML tags and decodes entities so feed-supplied summaries (and
// any other HTML-bearing string) land in the database as readable plain
// text rather than rendering as literal `<b>`, `<a href=...>`, `&amp;`,
// etc. on the frontend.
//
// Approach: parse the input as an HTML document fragment via jsdom and
// read `textContent`. This is the same parser the body extractor uses,
// so behavior is consistent across the pipeline. Whitespace from
// successive block elements is collapsed to a single space, then
// trimmed. Returns null when the input is null/undefined or strips to an
// empty string — the caller can then leave the column NULL rather than
// store an empty string.

import { JSDOM } from "jsdom";

export function stripHtml(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  if (input.length === 0) return null;

  // Fast path: no tags or entities — return trimmed input directly.
  // Avoids spinning up jsdom for the common case (already-clean text).
  if (!/[<&]/.test(input)) {
    const trimmed = input.trim();
    return trimmed.length === 0 ? null : trimmed;
  }

  // Pre-insert whitespace around tag boundaries that imply a visual line
  // break (jsdom's textContent collapses these to empty by default —
  // "Line one<br>Line two" otherwise becomes "Line oneLine two"). This
  // keeps the parser-based approach while preserving readable spacing.
  const padded = input.replace(/<\/?(br|p|div|li|tr|h[1-6])\b[^>]*>/gi, " $& ");

  let text: string;
  try {
    const dom = new JSDOM(`<!doctype html><body>${padded}</body>`);
    text = dom.window.document.body.textContent ?? "";
  } catch {
    // Pathological input that breaks jsdom — fall back to leaving the
    // raw string in place rather than nulling content. Should be
    // unreachable for any realistic feed input.
    return input.trim().length === 0 ? null : input.trim();
  }

  // Collapse internal whitespace (newlines from <br>, &nbsp;, etc.) to
  // single spaces.
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length === 0 ? null : collapsed;
}
