// Phase 12g — unit coverage for the derive-* helpers in
// scripts/backfillGenericCommentary.ts. The CLI shell isn't exercised
// (would require a real DB) but the per-row mapping is, since that's
// the part that has to be right for ~197 hand-curated stories and
// however many events the soak has produced.
//
// Stories template shape: 12a per-tier-string ({accessible, briefed,
// technical} as strings). Events template shape: 12e.5b per-tier
// {thesis, support}. Backfill picks the accessible field in both
// cases, concatenates for events, falls back to why_it_matters when
// the template is null / malformed / wrong shape.

import {
  deriveEventGenericCommentary,
  deriveStoryGenericCommentary,
} from "../src/scripts/backfillGenericCommentary";

describe("deriveStoryGenericCommentary (12a per-tier-string shape)", () => {
  it("extracts the accessible field from a valid 12a template", () => {
    const tpl = JSON.stringify({
      accessible: "Plain-English explanation.",
      briefed: "Working-professional take.",
      technical: "Insider details.",
    });
    expect(deriveStoryGenericCommentary("ignored", tpl)).toBe(
      "Plain-English explanation.",
    );
  });

  it("falls back to why_it_matters when the template is null", () => {
    expect(deriveStoryGenericCommentary("Fallback text.", null)).toBe(
      "Fallback text.",
    );
  });

  it("falls back to why_it_matters when the template is malformed JSON", () => {
    expect(deriveStoryGenericCommentary("Fallback text.", "{not json")).toBe(
      "Fallback text.",
    );
  });

  it("falls back to why_it_matters when the template has the wrong shape (events tier shape)", () => {
    const wrongShape = JSON.stringify({
      accessible: { thesis: "x", support: "y" },
      briefed: { thesis: "x", support: "y" },
      technical: { thesis: "x", support: "y" },
    });
    expect(deriveStoryGenericCommentary("Fallback.", wrongShape)).toBe(
      "Fallback.",
    );
  });

  it("falls back when the template's accessible field is empty whitespace", () => {
    const tpl = JSON.stringify({
      accessible: "   ",
      briefed: "b",
      technical: "t",
    });
    // The 12a schema requires min(1) per field, so this fails parsing
    // entirely → fallback path.
    expect(deriveStoryGenericCommentary("Fallback.", tpl)).toBe("Fallback.");
  });

  it("returns null only when both sources are empty", () => {
    expect(deriveStoryGenericCommentary("   ", null)).toBeNull();
  });
});

describe("deriveEventGenericCommentary (12e.5b per-tier {thesis, support})", () => {
  it("concatenates accessible.thesis and accessible.support with a single space", () => {
    // TierOutputSchema requires thesis/support ≥ 10 chars on EVERY
    // tier — the template fails strict parsing if any tier is short.
    const tpl = JSON.stringify({
      accessible: {
        thesis: "Thesis one accessible.",
        support: "Support body accessible.",
      },
      briefed: {
        thesis: "Thesis one briefed.",
        support: "Support body briefed.",
      },
      technical: {
        thesis: "Thesis one technical.",
        support: "Support body technical.",
      },
    });
    expect(deriveEventGenericCommentary("ignored", tpl)).toBe(
      "Thesis one accessible. Support body accessible.",
    );
  });

  it("falls back to why_it_matters when the template is null", () => {
    expect(deriveEventGenericCommentary("Event fallback.", null)).toBe(
      "Event fallback.",
    );
  });

  it("falls back to why_it_matters when the shape is the legacy 12a per-tier-string", () => {
    const wrongShape = JSON.stringify({
      accessible: "string only",
      briefed: "string only",
      technical: "string only",
    });
    expect(deriveEventGenericCommentary("Fallback.", wrongShape)).toBe(
      "Fallback.",
    );
  });

  it("returns null only when both sources are empty", () => {
    expect(deriveEventGenericCommentary("", null)).toBeNull();
  });
});
