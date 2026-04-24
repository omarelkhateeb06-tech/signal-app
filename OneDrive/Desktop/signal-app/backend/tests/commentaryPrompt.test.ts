import { buildCommentaryPrompt } from "../src/services/commentaryPrompt";
import { BANNED_PHRASES } from "../src/services/commentaryFallback";

function baseInputs(): Parameters<typeof buildCommentaryPrompt>[0] {
  return {
    depth: "standard",
    profile: {
      role: "engineer",
      domain: "climate_weather_forecasting",
      seniority: "mid",
      sectors: ["ai", "semiconductors"],
      goals: ["stay_current", "deep_learning"],
    },
    matchedTopics: ["foundation_models", "agents"],
    story: {
      sector: "ai",
      headline: "OpenAI announces GPT-5 with frontier-grade reasoning",
      context: "The release includes a new chain-of-thought mode and raised context window.",
      whyItMatters: "Resets the top of the capability frontier for commercial models.",
    },
  };
}

describe("buildCommentaryPrompt", () => {
  it("includes every profile field surfaced to the model", () => {
    const p = buildCommentaryPrompt(baseInputs());
    expect(p).toContain("Role: engineer");
    // Underscore values are humanized for display but we don't require
    // a specific rewrite — just that the raw token isn't leaked.
    expect(p).toContain("climate weather forecasting");
    expect(p).toContain("Seniority: mid");
    expect(p.toLowerCase()).toContain("ai");
    expect(p.toLowerCase()).toContain("semiconductors");
    expect(p.toLowerCase()).toContain("stay current");
  });

  it("surfaces matched topics when present", () => {
    const p = buildCommentaryPrompt(baseInputs());
    expect(p.toLowerCase()).toContain("foundation models");
    expect(p.toLowerCase()).toContain("agents");
  });

  it("omits the matched-topics line entirely when no topics matched", () => {
    // When the user picked no topics in this story's sector, the
    // prompt should NOT attempt to fabricate a connection. The line
    // key is "Topics they flagged in" — its absence is the contract.
    const p = buildCommentaryPrompt({ ...baseInputs(), matchedTopics: [] });
    expect(p).not.toContain("Topics they flagged in");
  });

  it("includes the story headline, context, and editorial baseline", () => {
    const p = buildCommentaryPrompt(baseInputs());
    expect(p).toContain("OpenAI announces GPT-5 with frontier-grade reasoning");
    expect(p).toContain("The release includes a new chain-of-thought mode");
    expect(p).toContain("Resets the top of the capability frontier");
  });

  it("includes depth-specific guidance that differs per depth", () => {
    const accessible = buildCommentaryPrompt({ ...baseInputs(), depth: "accessible" });
    const technical = buildCommentaryPrompt({ ...baseInputs(), depth: "technical" });
    expect(accessible).toContain("Audience depth: accessible");
    expect(technical).toContain("Audience depth: technical");
    // Depth guidance must differ between the two — if someone
    // flattens the DEPTH_GUIDANCE map this catches it.
    expect(accessible).not.toBe(technical);
    expect(accessible).toContain("Plain language");
    expect(technical).toContain("Domain insider");
  });

  it("enumerates every entry in BANNED_PHRASES inside the prompt's banned list", () => {
    // The prompt instructs the model to avoid these phrases; drift
    // between the list and what we embed in the prompt would silently
    // weaken the gate.
    const p = buildCommentaryPrompt(baseInputs());
    for (const phrase of BANNED_PHRASES) {
      expect(p).toContain(phrase);
    }
  });

  it("tells the model to output ONLY the commentary (no preamble, no headers)", () => {
    const p = buildCommentaryPrompt(baseInputs());
    // Exact-substring assertion — the v2 controller layer relies on
    // the absence of preamble to surface the text directly, so this
    // line is a stability anchor, not just a style note.
    expect(p).toContain("Output ONLY the commentary paragraph.");
  });

  it("tolerates null profile fields without crashing or leaking 'null' into the prompt", () => {
    // Landing here with a null-heavy profile means the service layer
    // is about to bail to Tier 3 fallback, but the prompt builder must
    // not crash mid-assembly if a caller invokes it anyway.
    const p = buildCommentaryPrompt({
      ...baseInputs(),
      profile: {
        role: null,
        domain: null,
        seniority: null,
        sectors: null,
        goals: null,
      },
    });
    expect(p).not.toContain("null");
    expect(p).not.toContain("Role: null");
  });
});
