import {
  BANNED_PHRASES,
  buildFallbackCommentary,
  checkBannedPhrases,
} from "../src/services/commentaryFallback";

function baseInput(overrides: Partial<Parameters<typeof buildFallbackCommentary>[0]> = {}) {
  return {
    storyHeadline: "OpenAI announces GPT-5 with frontier-grade reasoning",
    storySector: "ai",
    storyWhyItMatters: "The new model resets the top of the capability frontier.",
    profile: {
      role: "engineer",
      domain: "climate_weather_forecasting",
      seniority: "mid",
    },
    matched: {
      matchedSector: true,
      matchedTopics: ["foundation_models"],
    },
    ...overrides,
  };
}

describe("checkBannedPhrases", () => {
  it("returns clean=true for neutral copy", () => {
    const r = checkBannedPhrases("A modest improvement in inference throughput.");
    expect(r.clean).toBe(true);
    expect(r.offenders).toEqual([]);
  });

  it("flags offenders case-insensitively and lists them by the canonical phrase", () => {
    const r = checkBannedPhrases("This GROUNDBREAKING release is unprecedented.");
    expect(r.clean).toBe(false);
    expect(r.offenders.sort()).toEqual(["groundbreaking", "unprecedented"].sort());
  });

  it("respects word boundaries — 'evolutionary' does not trip 'revolutionary'", () => {
    const r = checkBannedPhrases("An evolutionary improvement over the prior release.");
    expect(r.clean).toBe(true);
  });

  it("covers every phrase in BANNED_PHRASES", () => {
    // Sanity check that the canonical list and the regex list stay in
    // sync — if someone adds a phrase to BANNED_PHRASES but the
    // pattern builder drifts, this breaks.
    for (const phrase of BANNED_PHRASES) {
      const r = checkBannedPhrases(`Leading with ${phrase} framing.`);
      expect(r.clean).toBe(false);
      expect(r.offenders).toContain(phrase);
    }
  });
});

describe("buildFallbackCommentary — tier selection", () => {
  it("tier1: full profile + matched sector + at least one matched topic", () => {
    const out = buildFallbackCommentary(baseInput());
    expect(out.tier).toBe("tier1");
    expect(out.anomaly).toBeUndefined();
    // Tier 1 thesis names a matched topic by its human label
    // ("foundation models") — anchors the fallback on the overlap.
    const combined = `${out.commentary.thesis} ${out.commentary.support}`.toLowerCase();
    expect(combined).toContain("foundation models");
  });

  it("tier2: full profile + matched sector but NO matched topics", () => {
    const out = buildFallbackCommentary(
      baseInput({ matched: { matchedSector: true, matchedTopics: [] } }),
    );
    expect(out.tier).toBe("tier2");
    expect(out.anomaly).toBeUndefined();
    // Tier 2 still names the role.
    const combined = `${out.commentary.thesis} ${out.commentary.support}`.toLowerCase();
    expect(combined).toContain("engineer");
  });

  it("tier3 + anomaly: profile missing role", () => {
    const out = buildFallbackCommentary(
      baseInput({ profile: { role: null, domain: "foo", seniority: "mid" } }),
    );
    expect(out.tier).toBe("tier3");
    expect(out.anomaly).toBeDefined();
    expect(out.anomaly!.reason).toBe("missing_profile_fields");
    expect(out.anomaly!.missingProfileFields).toEqual(["role"]);
  });

  it("tier3 + anomaly: story sector not in user's sectors (off_sector)", () => {
    // Full profile, but the story is for a sector the user didn't pick.
    // Example: direct story-detail link to a finance story from a user
    // who only onboarded AI + semiconductors.
    const out = buildFallbackCommentary(
      baseInput({ matched: { matchedSector: false, matchedTopics: [] } }),
    );
    expect(out.tier).toBe("tier3");
    expect(out.anomaly).toBeDefined();
    expect(out.anomaly!.reason).toBe("off_sector");
  });

  it("tier3 + anomaly: Haiku failure reason propagates verbatim", () => {
    // The commentaryService layer maps Haiku errors to Tier3Reason
    // values and passes them in via haikuFailureReason. The fallback
    // must surface them in the anomaly without re-deriving.
    const out = buildFallbackCommentary(
      baseInput({ haikuFailureReason: "haiku_timeout" }),
    );
    expect(out.tier).toBe("tier3");
    expect(out.anomaly).toBeDefined();
    expect(out.anomaly!.reason).toBe("haiku_timeout");
  });
});

describe("buildFallbackCommentary — anomaly log shape", () => {
  it("always stamps the canonical event string", () => {
    const out = buildFallbackCommentary(
      baseInput({ profile: { role: null, domain: null, seniority: null } }),
    );
    expect(out.anomaly!.event).toBe("commentary_tier3_fallback");
  });

  it("missingProfileFields lists every missing field in order (role, domain, seniority)", () => {
    const out = buildFallbackCommentary(
      baseInput({ profile: { role: null, domain: null, seniority: null } }),
    );
    expect(out.anomaly!.missingProfileFields).toEqual([
      "role",
      "domain",
      "seniority",
    ]);
  });

  it("does NOT emit an anomaly on tier1 or tier2", () => {
    const t1 = buildFallbackCommentary(baseInput());
    const t2 = buildFallbackCommentary(
      baseInput({ matched: { matchedSector: true, matchedTopics: [] } }),
    );
    expect(t1.anomaly).toBeUndefined();
    expect(t2.anomaly).toBeUndefined();
  });
});

describe("buildFallbackCommentary — template banned-phrase scrub (defense-in-depth)", () => {
  // This exercises the scrubber path directly — in production, the
  // hand-written templates should never trip the check, so this test
  // simulates a regression where a template fragment leaked a banned
  // phrase. We do it by feeding a whyItMatters that contains one
  // — the template concatenates it, so the output inherits it.
  it("scrubs a banned phrase from the story baseline and logs templateOffenders", () => {
    const out = buildFallbackCommentary(
      baseInput({
        storyWhyItMatters: "A game-changing release with revolutionary implications.",
      }),
    );
    const combined = `${out.commentary.thesis} ${out.commentary.support}`.toLowerCase();
    expect(combined).not.toContain("game-changing");
    expect(combined).not.toContain("revolutionary");
    // Tier becomes tier3 (the scrub is always an anomaly) and the
    // anomaly carries templateOffenders.
    expect(out.tier).toBe("tier3");
    expect(out.anomaly).toBeDefined();
    expect(out.anomaly!.templateOffenders).toBeDefined();
    const offenders = out.anomaly!.templateOffenders ?? [];
    expect(offenders).toContain("game-changing");
    expect(offenders).toContain("revolutionary");
  });
});
