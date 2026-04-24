import { computeMatchedInterests } from "../src/utils/matchedInterests";

describe("computeMatchedInterests", () => {
  it("returns matchedSector=true when the story sector is in the user's sectors", () => {
    const out = computeMatchedInterests({
      storySector: "ai",
      userSectors: ["ai", "finance"],
      userTopicsForSector: [],
    });
    expect(out.matchedSector).toBe(true);
  });

  it("returns matchedSector=false when the story sector is NOT in the user's sectors", () => {
    const out = computeMatchedInterests({
      storySector: "semiconductors",
      userSectors: ["ai", "finance"],
      userTopicsForSector: [],
    });
    expect(out.matchedSector).toBe(false);
  });

  it("filters topics to those declared against the story's sector only", () => {
    // Cross-sector topic picks must not appear — a user who picked
    // "foundation_models" under ai does NOT have that as a matched
    // topic for a finance story.
    const out = computeMatchedInterests({
      storySector: "finance",
      userSectors: ["ai", "finance"],
      userTopicsForSector: [
        { sector: "ai", topic: "foundation_models" },
        { sector: "finance", topic: "rates_and_macro" },
        { sector: "ai", topic: "agents" },
        { sector: "finance", topic: "credit" },
      ],
    });
    expect(out.matchedTopics).toEqual(["rates_and_macro", "credit"]);
  });

  it("dedupes duplicate (sector, topic) pairs in the input", () => {
    const out = computeMatchedInterests({
      storySector: "ai",
      userSectors: ["ai"],
      userTopicsForSector: [
        { sector: "ai", topic: "foundation_models" },
        { sector: "ai", topic: "foundation_models" },
        { sector: "ai", topic: "agents" },
      ],
    });
    expect(out.matchedTopics).toEqual(["foundation_models", "agents"]);
  });

  it("treats null/undefined inputs as empty", () => {
    // Mirrors the production path where a pre-onboarding profile row
    // (from unsubscribe) exists with null sectors + no topics yet.
    const out = computeMatchedInterests({
      storySector: "ai",
      userSectors: null,
      userTopicsForSector: undefined,
    });
    expect(out.matchedSector).toBe(false);
    expect(out.matchedTopics).toEqual([]);
  });
});
