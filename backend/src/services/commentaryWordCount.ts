// Phase 12d — word-count drift validator for Haiku commentary.
//
// Symmetric ±20% gate per Decision 12d (post-review). Output is a
// list of warnings; the validator never rejects — over- or under-
// budget commentary still ships, the warning lands in the structured
// log so dashboard filters can pick up persistent drift across users
// or depths.
//
// Word counting is `/\S+/g` (run-of-non-whitespace), matching how the
// model interprets "words" in the prompt budgets. Punctuation glued
// to a word counts as one token; em-dashes inside a word ("role-
// neutral") count as one. Cheap and correct enough for budgeting.

import type { CommentaryWordBudgets } from "./commentaryPromptV2";

export const WORD_COUNT_DRIFT_THRESHOLD = 0.2;

export type WordCountField = "thesis" | "support";
export type WordCountDirection = "over" | "under";

export interface WordCountWarning {
  field: WordCountField;
  direction: WordCountDirection;
  actualWords: number;
  budgetWords: number;
  // Computed once here so log consumers don't have to redo the math.
  // Stored as raw ratio (e.g. 0.32 for "32% over"); -0.24 means 24%
  // under.
  driftRatio: number;
}

function countWords(text: string): number {
  const matches = text.match(/\S+/g);
  return matches ? matches.length : 0;
}

function classify(
  field: WordCountField,
  actual: number,
  budget: number,
): WordCountWarning | null {
  if (budget <= 0) return null;
  const drift = (actual - budget) / budget;
  if (Math.abs(drift) <= WORD_COUNT_DRIFT_THRESHOLD) return null;
  return {
    field,
    direction: drift > 0 ? "over" : "under",
    actualWords: actual,
    budgetWords: budget,
    driftRatio: drift,
  };
}

/**
 * Validate `{thesis, support}` against the per-depth budgets. Returns
 * an array of warnings; empty array = within budget on both fields.
 */
export function validateWordBudgets(
  commentary: { thesis: string; support: string },
  budgets: CommentaryWordBudgets,
): WordCountWarning[] {
  const warnings: WordCountWarning[] = [];
  const thesisWarn = classify(
    "thesis",
    countWords(commentary.thesis),
    budgets.thesis,
  );
  if (thesisWarn) warnings.push(thesisWarn);
  const supportWarn = classify(
    "support",
    countWords(commentary.support),
    budgets.support,
  );
  if (supportWarn) warnings.push(supportWarn);
  return warnings;
}
