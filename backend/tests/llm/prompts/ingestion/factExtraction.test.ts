import {
  buildFactExtractionPrompt,
  FACTS_DEFAULT_MAX_TOKENS,
  FACTS_PROMPT_ASSISTANT_PREFILL,
  FACTS_PROMPT_ASSISTANT_PREFILL_STRICT,
  FACTS_PROMPT_BODY_CAP_CHARS,
} from "../../../../src/llm/prompts/ingestion/factExtraction";

describe("buildFactExtractionPrompt", () => {
  it("includes the title verbatim", () => {
    const prompt = buildFactExtractionPrompt({
      title: "TSMC reports record Q1 results",
      bodyText: "TSMC's revenue beat estimates...",
      sector: "semiconductors",
    });
    expect(prompt).toContain("Title: TSMC reports record Q1 results");
  });

  it("includes the body text under the cap unchanged", () => {
    const body = "TSMC reported strong Q1 results. AI demand drove the beat.";
    const prompt = buildFactExtractionPrompt({
      title: "T",
      bodyText: body,
      sector: "ai",
    });
    expect(prompt).toContain(body);
    expect(prompt).not.toContain("[...truncated]");
  });

  it("truncates body and appends marker when over the cap", () => {
    const body = "x".repeat(FACTS_PROMPT_BODY_CAP_CHARS + 500);
    const prompt = buildFactExtractionPrompt({
      title: "t",
      bodyText: body,
      sector: "finance",
    });
    expect(prompt).toContain("[...truncated]");
    const expectedSlice = "x".repeat(FACTS_PROMPT_BODY_CAP_CHARS);
    expect(prompt).toContain(expectedSlice + "\n[...truncated]");
  });

  it("does not truncate when body is exactly at the cap", () => {
    const body = "y".repeat(FACTS_PROMPT_BODY_CAP_CHARS);
    const prompt = buildFactExtractionPrompt({
      title: "t",
      bodyText: body,
      sector: "ai",
    });
    expect(prompt).not.toContain("[...truncated]");
  });

  it("trims whitespace from title and body", () => {
    const prompt = buildFactExtractionPrompt({
      title: "   spaced title   ",
      bodyText: "\n\n body \n\n",
      sector: "ai",
    });
    expect(prompt).toContain("Title: spaced title");
    expect(prompt).toContain("Body:\nbody");
  });

  it("renders the sector tag verbatim in the user message", () => {
    const prompt = buildFactExtractionPrompt({
      title: "t",
      bodyText: "b",
      sector: "ai",
    });
    expect(prompt).toContain("Sector tag: ai");
  });

  it.each([["ai"], ["finance"], ["semiconductors"]] as const)(
    "renders sector=%s",
    (sector) => {
      const prompt = buildFactExtractionPrompt({
        title: "t",
        bodyText: "b",
        sector,
      });
      expect(prompt).toContain(`Sector tag: ${sector}`);
    },
  );

  it("frames the sector tag as soft context, not constraint", () => {
    const prompt = buildFactExtractionPrompt({
      title: "t",
      bodyText: "b",
      sector: "ai",
    });
    expect(prompt).toMatch(/Do not invent sector-relevant facts that are not in the body/i);
  });

  it("instructs the model to return a 'facts' array of 5–8 fact objects", () => {
    const prompt = buildFactExtractionPrompt({
      title: "t",
      bodyText: "b",
      sector: "ai",
    });
    expect(prompt).toContain('"facts"');
    expect(prompt).toMatch(/array of 5 to 8 fact objects/i);
  });

  it("specifies the per-fact shape: text + category", () => {
    const prompt = buildFactExtractionPrompt({
      title: "t",
      bodyText: "b",
      sector: "ai",
    });
    expect(prompt).toContain('"text"');
    expect(prompt).toContain('"category"');
  });

  it("names the seven suggested categories", () => {
    const prompt = buildFactExtractionPrompt({
      title: "t",
      bodyText: "b",
      sector: "ai",
    });
    for (const cat of [
      "actor",
      "action",
      "metric",
      "timeframe",
      "market_reaction",
      "technical_detail",
      "context",
    ]) {
      expect(prompt).toContain(`"${cat}"`);
    }
  });

  it("instructs the model that category may be a different label when one of the suggested ones doesn't fit", () => {
    const prompt = buildFactExtractionPrompt({
      title: "t",
      bodyText: "b",
      sector: "ai",
    });
    expect(prompt).toMatch(/different category label/i);
    expect(prompt).toMatch(/snake_case/i);
  });

  it("includes the hedging-with-attribution example", () => {
    const prompt = buildFactExtractionPrompt({
      title: "t",
      bodyText: "b",
      sector: "ai",
    });
    expect(prompt).toContain("Goldman expects rates to drop 50bps in Q3");
  });

  it("instructs against opinions / speculation / unhedged forecasts", () => {
    const prompt = buildFactExtractionPrompt({
      title: "t",
      bodyText: "b",
      sector: "ai",
    });
    expect(prompt).toMatch(/No opinions, no speculation, no hedging language/);
  });

  it("instructs against extracting the article author's editorial commentary", () => {
    const prompt = buildFactExtractionPrompt({
      title: "t",
      bodyText: "b",
      sector: "ai",
    });
    expect(prompt).toMatch(/article author's editorial commentary/i);
  });

  it("instructs that every fact must appear in the body (no invention)", () => {
    const prompt = buildFactExtractionPrompt({
      title: "t",
      bodyText: "b",
      sector: "ai",
    });
    expect(prompt).toMatch(/Every fact must appear in the body/i);
    expect(prompt).toMatch(/Do not invent facts/i);
  });

  it("instructs against duplicating facts", () => {
    const prompt = buildFactExtractionPrompt({
      title: "t",
      bodyText: "b",
      sector: "ai",
    });
    expect(prompt).toMatch(/Do not duplicate facts/i);
  });

  it("instructs JSON-only output (no Markdown fencing)", () => {
    const prompt = buildFactExtractionPrompt({
      title: "t",
      bodyText: "b",
      sector: "ai",
    });
    expect(prompt).toMatch(/JSON/i);
    expect(prompt).toMatch(/no Markdown/i);
  });

  it('exports the default prefill as `{`', () => {
    expect(FACTS_PROMPT_ASSISTANT_PREFILL).toBe("{");
  });

  it('exports the strict prefill as `{"facts":`', () => {
    expect(FACTS_PROMPT_ASSISTANT_PREFILL_STRICT).toBe('{"facts":');
  });

  it("body cap is 8000 chars (locked decision; matches relevance gate)", () => {
    expect(FACTS_PROMPT_BODY_CAP_CHARS).toBe(8000);
  });

  it("default max_tokens is 800", () => {
    expect(FACTS_DEFAULT_MAX_TOKENS).toBe(800);
  });
});
