import {
  buildExpandableCommentaryPrompt,
  COMMENTARY_PREFILL,
  getWordBudgets,
} from "../src/services/commentaryPromptV2";
import { BANNED_PHRASES } from "../src/services/commentaryFallback";

function baseInputs(): Parameters<typeof buildExpandableCommentaryPrompt>[0] {
  return {
    depth: "briefed",
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

describe("buildExpandableCommentaryPrompt", () => {
  it("includes every profile field surfaced to the model", () => {
    const p = buildExpandableCommentaryPrompt(baseInputs());
    expect(p).toContain("Role: engineer");
    expect(p).toContain("climate weather forecasting");
    expect(p).toContain("Seniority: mid");
    expect(p.toLowerCase()).toContain("ai");
    expect(p.toLowerCase()).toContain("semiconductors");
    expect(p.toLowerCase()).toContain("stay current");
  });

  it("surfaces matched topics when present", () => {
    const p = buildExpandableCommentaryPrompt(baseInputs());
    expect(p.toLowerCase()).toContain("foundation models");
    expect(p.toLowerCase()).toContain("agents");
  });

  it("omits matched-topic block entirely when none match", () => {
    const p = buildExpandableCommentaryPrompt({
      ...baseInputs(),
      matchedTopics: [],
    });
    expect(p).not.toContain("Topics they flagged");
  });

  it("declares the JSON schema in-prompt", () => {
    const p = buildExpandableCommentaryPrompt(baseInputs());
    expect(p).toContain('{ "thesis": string, "support": string }');
    expect(p).toContain("Output JSON ONLY");
    expect(p).toContain("Return ONLY the JSON object");
  });

  it("includes a one-shot example with the JSON shape", () => {
    const p = buildExpandableCommentaryPrompt(baseInputs());
    // The example is hand-written against an unrelated TSMC story so
    // the model can't lift phrasing — assert the structural anchors,
    // not the example text verbatim, so example tuning doesn't churn
    // this test.
    expect(p).toContain("Example output for an unrelated story");
    expect(p).toMatch(/"thesis":/);
    expect(p).toMatch(/"support":/);
  });

  it("maps internal depth enum to the user-facing depth label", () => {
    const accessible = buildExpandableCommentaryPrompt({
      ...baseInputs(),
      depth: "accessible",
    });
    expect(accessible).toContain("Audience depth: Accessible");

    const briefed = buildExpandableCommentaryPrompt({
      ...baseInputs(),
      depth: "briefed",
    });
    expect(briefed).toContain("Audience depth: Briefed");

    const technical = buildExpandableCommentaryPrompt({
      ...baseInputs(),
      depth: "technical",
    });
    expect(technical).toContain("Audience depth: Technical");
  });

  it("instructs against banned openers per Decision 12d", () => {
    const p = buildExpandableCommentaryPrompt(baseInputs());
    expect(p).toContain('"As a [role]"');
    expect(p).toContain('"As you [verb]"');
    expect(p).toContain('"For someone [verb]"');
  });

  it("lists every BANNED_PHRASES entry", () => {
    const p = buildExpandableCommentaryPrompt(baseInputs());
    for (const phrase of BANNED_PHRASES) {
      expect(p).toContain(`- ${phrase}`);
    }
  });

  it("differentiates per-depth budgets in the prompt body", () => {
    // Each depth should advertise distinct word budgets so the model
    // doesn't read accessible/briefed/technical as interchangeable.
    const a = buildExpandableCommentaryPrompt({ ...baseInputs(), depth: "accessible" });
    const b = buildExpandableCommentaryPrompt({ ...baseInputs(), depth: "briefed" });
    const t = buildExpandableCommentaryPrompt({ ...baseInputs(), depth: "technical" });
    expect(a).toContain("~35 words");
    expect(b).toContain("~40 words");
    expect(t).toContain("~130 words");
  });
});

describe("getWordBudgets", () => {
  it("returns the per-depth budget pair the prompt advertises", () => {
    expect(getWordBudgets("accessible")).toEqual({ thesis: 35, support: 70 });
    expect(getWordBudgets("briefed")).toEqual({ thesis: 40, support: 90 });
    expect(getWordBudgets("technical")).toEqual({ thesis: 40, support: 130 });
  });
});

describe("COMMENTARY_PREFILL", () => {
  it("is the literal opening brace", () => {
    expect(COMMENTARY_PREFILL).toBe("{");
  });
});
