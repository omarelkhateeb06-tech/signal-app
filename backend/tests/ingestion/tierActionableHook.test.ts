import {
  buildTierAccessiblePrompt,
  ACTIONABLE_DIRECTIVE,
} from "../../src/llm/prompts/ingestion/tierAccessible";
import { buildTierBriefedPrompt } from "../../src/llm/prompts/ingestion/tierBriefed";
import { buildTierTechnicalPrompt } from "../../src/llm/prompts/ingestion/tierTechnical";

const base = {
  title: "Cascade — KV-cache offload that halves inference memory",
  bodyText: "An open-source library that streams attention KV-cache to NVMe.",
  sector: "ai" as const,
  facts: [{ text: "Halves GPU memory for long-context inference.", category: "claim" }],
};

const builders = [
  ["accessible", buildTierAccessiblePrompt],
  ["briefed", buildTierBriefedPrompt],
  ["technical", buildTierTechnicalPrompt],
] as const;

describe("Phase 12R — what-to-do-with-it hook on tier prompts", () => {
  it("the actionable directive mentions doing/applying, not just significance", () => {
    expect(ACTIONABLE_DIRECTIVE).toMatch(/what they can DO|APPLY/);
    expect(ACTIONABLE_DIRECTIVE.toLowerCase()).toContain("why now");
  });

  for (const [name, build] of builders) {
    it(`${name}: injects the directive when actionable=true`, () => {
      const prompt = build({ ...base, actionable: true });
      expect(prompt).toContain(ACTIONABLE_DIRECTIVE);
    });

    it(`${name}: omits the directive by default (analysis content)`, () => {
      expect(build(base)).not.toContain(ACTIONABLE_DIRECTIVE);
      expect(build({ ...base, actionable: false })).not.toContain(
        ACTIONABLE_DIRECTIVE,
      );
    });
  }
});
