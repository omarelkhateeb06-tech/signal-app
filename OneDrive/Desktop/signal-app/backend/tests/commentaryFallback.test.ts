import {
  BANNED_PHRASES,
  buildFallbackCommentary,
  checkBannedOpeners,
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

describe("checkBannedOpeners", () => {
  const cleanSupport = "Inference cost dropped roughly 40% versus the prior tier.";

  it("flags 'As you build…' (bare-verb form, regression)", () => {
    const r = checkBannedOpeners({
      thesis: "As you build agents on top of this stack, latency budgets shift.",
      support: cleanSupport,
    });
    expect(r.clean).toBe(false);
    expect(r.offenders).toEqual([
      { field: "thesis", pattern: "^\\s*As you\\b" },
    ]);
  });

  it("flags 'As you're thinking…' (apostrophe contraction)", () => {
    // Pre-Cluster-1.3 the regex was /^\s*As you\s+\w+/i, which required
    // whitespace + a word after "you" and so missed contractions like
    // "As you're". The \b form catches the boundary between `you` and
    // the apostrophe.
    const r = checkBannedOpeners({
      thesis: "As you're thinking about MCP servers, the cost calculus changes.",
      support: cleanSupport,
    });
    expect(r.clean).toBe(false);
    expect(r.offenders).toEqual([
      { field: "thesis", pattern: "^\\s*As you\\b" },
    ]);
  });

  it("flags 'For an X…' role-framing openers", () => {
    const r = checkBannedOpeners({
      thesis: "For an ML engineer tracking foundation-model latency, this lands.",
      support: cleanSupport,
    });
    expect(r.clean).toBe(false);
    expect(r.offenders).toEqual([
      { field: "thesis", pattern: "^\\s*For (a|an|the)\\s+\\w+" },
    ]);
  });

  it("flags 'For a brief moment…' (known false-positive — soft-fail tradeoff)", () => {
    // The /^\s*For (a|an|the)\s+\w+/ pattern intentionally accepts this
    // false-positive: it would take a much heavier classifier to
    // distinguish role-framing ("For an engineer…") from temporal
    // openings ("For a brief moment…"). Because a BANNED_OPENERS hit
    // demotes the response to the Tier-3 fallback (per the file header
    // in commentaryFallback.ts) rather than erroring, the cost of a
    // false-positive is a templated commentary instead of the Haiku
    // output — acceptable trade for closing the role-framing loophole.
    const r = checkBannedOpeners({
      thesis: "For a brief moment, the market priced this in as a regime change.",
      support: cleanSupport,
    });
    expect(r.clean).toBe(false);
    expect(r.offenders).toEqual([
      { field: "thesis", pattern: "^\\s*For (a|an|the)\\s+\\w+" },
    ]);
  });

  it("returns clean=true for analytical openers", () => {
    const r = checkBannedOpeners({
      thesis: "Inference cost is the headline; ranking implications follow.",
      support: cleanSupport,
    });
    expect(r.clean).toBe(true);
    expect(r.offenders).toEqual([]);
  });

  it("checks support independently of thesis", () => {
    const r = checkBannedOpeners({
      thesis: "Inference cost dropped 40% across the board.",
      support: "As you ship to prod, watch the new ceiling on context tokens.",
    });
    expect(r.clean).toBe(false);
    expect(r.offenders).toEqual([
      { field: "support", pattern: "^\\s*As you\\b" },
    ]);
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
