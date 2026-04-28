import {
  buildRelevanceGatePrompt,
  RELEVANCE_GATE_ASSISTANT_PREFILL,
  RELEVANCE_GATE_ASSISTANT_PREFILL_STRICT,
  RELEVANCE_GATE_BODY_CAP_CHARS,
} from "../../../../src/llm/prompts/ingestion/relevanceGate";

describe("buildRelevanceGatePrompt", () => {
  it("includes the title verbatim", () => {
    const prompt = buildRelevanceGatePrompt({
      title: "TSMC reports record Q1 results",
      bodyText: "TSMC's revenue beat estimates...",
    });
    expect(prompt).toContain("Title: TSMC reports record Q1 results");
  });

  it("includes the body text under the cap unchanged", () => {
    const body = "TSMC reported strong Q1 results. AI demand drove the beat.";
    const prompt = buildRelevanceGatePrompt({ title: "T", bodyText: body });
    expect(prompt).toContain(body);
    expect(prompt).not.toContain("[...truncated]");
  });

  it("truncates body and appends marker when over the cap", () => {
    const body = "x".repeat(RELEVANCE_GATE_BODY_CAP_CHARS + 500);
    const prompt = buildRelevanceGatePrompt({ title: "t", bodyText: body });
    expect(prompt).toContain("[...truncated]");
    // Body section in prompt is after the "Body:" marker; sanity-check
    // that the truncated content is exactly cap-length followed by the marker.
    const expectedSlice = "x".repeat(RELEVANCE_GATE_BODY_CAP_CHARS);
    expect(prompt).toContain(expectedSlice + "\n[...truncated]");
  });

  it("does not truncate when body is exactly at the cap", () => {
    const body = "y".repeat(RELEVANCE_GATE_BODY_CAP_CHARS);
    const prompt = buildRelevanceGatePrompt({ title: "t", bodyText: body });
    expect(prompt).not.toContain("[...truncated]");
  });

  it("trims whitespace from title and body", () => {
    const prompt = buildRelevanceGatePrompt({
      title: "   spaced title   ",
      bodyText: "\n\n body \n\n",
    });
    expect(prompt).toContain("Title: spaced title");
    // After trim, the body becomes just "body".
    expect(prompt).toContain("Body:\nbody");
  });

  it("instructs the model to return the three required fields", () => {
    const prompt = buildRelevanceGatePrompt({ title: "t", bodyText: "b" });
    expect(prompt).toContain('"relevant"');
    expect(prompt).toContain('"sector"');
    expect(prompt).toContain('"reason"');
  });

  it("locks the sector vocabulary to ai/finance/semiconductors", () => {
    const prompt = buildRelevanceGatePrompt({ title: "t", bodyText: "b" });
    expect(prompt).toContain('"ai"');
    expect(prompt).toContain('"finance"');
    expect(prompt).toContain('"semiconductors"');
    // Out-of-scope guidance must be present (G5 — no "other" escape hatch).
    expect(prompt).toMatch(/relevant=false/i);
  });

  it("instructs JSON-only output (no Markdown fencing)", () => {
    const prompt = buildRelevanceGatePrompt({ title: "t", bodyText: "b" });
    expect(prompt).toMatch(/JSON/i);
    expect(prompt).toMatch(/no Markdown/i);
  });

  it("exports the default prefill as `{`", () => {
    expect(RELEVANCE_GATE_ASSISTANT_PREFILL).toBe("{");
  });

  it('exports the strict prefill as `{"relevant":`', () => {
    expect(RELEVANCE_GATE_ASSISTANT_PREFILL_STRICT).toBe('{"relevant":');
  });

  it("body cap is 8000 chars (G8 lock)", () => {
    expect(RELEVANCE_GATE_BODY_CAP_CHARS).toBe(8000);
  });
});
