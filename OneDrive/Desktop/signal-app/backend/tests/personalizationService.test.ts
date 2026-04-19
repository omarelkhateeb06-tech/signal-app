import { personalizeStory, rolePhraseFor } from "../src/services/personalizationService";

describe("rolePhraseFor", () => {
  it("returns the engineer phrase", () => {
    expect(rolePhraseFor("engineer")).toContain("engineer");
  });

  it("returns the researcher phrase", () => {
    expect(rolePhraseFor("researcher")).toContain("researcher");
  });

  it("returns the manager phrase", () => {
    expect(rolePhraseFor("manager")).toContain("manager");
  });

  it("returns the vc phrase", () => {
    expect(rolePhraseFor("vc")).toContain("investor");
  });

  it("returns the analyst phrase", () => {
    expect(rolePhraseFor("analyst")).toContain("analyst");
  });

  it("returns the founder phrase", () => {
    expect(rolePhraseFor("founder")).toContain("founder");
  });

  it("returns the executive phrase", () => {
    expect(rolePhraseFor("executive")).toContain("executive");
  });

  it("returns the student phrase", () => {
    expect(rolePhraseFor("student")).toContain("student");
  });

  it("returns the other phrase for 'other'", () => {
    expect(rolePhraseFor("other")).toContain("landscape is shifting");
  });

  it("is case-insensitive", () => {
    expect(rolePhraseFor("ENGINEER")).toBe(rolePhraseFor("engineer"));
    expect(rolePhraseFor("Engineer")).toBe(rolePhraseFor("engineer"));
  });

  it("falls back to the 'other' phrase for unknown roles", () => {
    expect(rolePhraseFor("wizard")).toBe(rolePhraseFor("other"));
  });

  it("falls back to the 'other' phrase when role is null", () => {
    expect(rolePhraseFor(null)).toBe(rolePhraseFor("other"));
  });

  it("falls back to the 'other' phrase when role is undefined", () => {
    expect(rolePhraseFor(undefined)).toBe(rolePhraseFor("other"));
  });
});

describe("personalizeStory", () => {
  it("substitutes {role_phrase} in the template when provided", () => {
    const result = personalizeStory({
      whyItMatters: "The industry is changing.",
      whyItMattersTemplate: "{role_phrase} because new chips ship.",
      role: "engineer",
    });
    expect(result).toBe(
      "As an engineer, this affects your implementation decisions because new chips ship.",
    );
  });

  it("replaces every occurrence of {role_phrase}", () => {
    const result = personalizeStory({
      whyItMatters: "n/a",
      whyItMattersTemplate: "{role_phrase}. Also, {role_phrase}.",
      role: "founder",
    });
    const phrase = rolePhraseFor("founder");
    expect(result).toBe(`${phrase}. Also, ${phrase}.`);
  });

  it("falls back to `${phrase}. ${whyItMatters}` when no template", () => {
    const result = personalizeStory({
      whyItMatters: "AI costs are dropping.",
      whyItMattersTemplate: null,
      role: "vc",
    });
    expect(result).toBe(
      `${rolePhraseFor("vc")}. AI costs are dropping.`,
    );
  });

  it("falls back when template has no {role_phrase} token", () => {
    const result = personalizeStory({
      whyItMatters: "x",
      whyItMattersTemplate: "static template text",
      role: "analyst",
    });
    expect(result).toBe(`${rolePhraseFor("analyst")}. x`);
  });

  it("uses the 'other' phrase when role is null", () => {
    const result = personalizeStory({
      whyItMatters: "Hello.",
      whyItMattersTemplate: null,
      role: null,
    });
    expect(result).toBe(`${rolePhraseFor("other")}. Hello.`);
  });
});
