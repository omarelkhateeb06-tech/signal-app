import {
  BODY_LENGTH_FLOOR_CHARS,
  HEURISTIC_REASONS,
  isNonArticleUrl,
  isRecent,
  isSummaryAndTitleEmpty,
  matchesNoisePattern,
  meetsLengthFloor,
  noiseCategoryToReason,
  RECENCY_CUTOFF_HOURS,
} from "../../src/jobs/ingestion/heuristics";

describe("heuristics — pure functions", () => {
  describe("isRecent", () => {
    const now = new Date("2026-04-27T12:00:00Z");

    it("returns true for items within the 36h cutoff", () => {
      const recent = new Date(now.getTime() - 35 * 60 * 60 * 1000);
      expect(isRecent(recent, now)).toBe(true);
    });

    it("returns true at exactly 36h boundary (inclusive)", () => {
      const at = new Date(now.getTime() - RECENCY_CUTOFF_HOURS * 60 * 60 * 1000);
      expect(isRecent(at, now)).toBe(true);
    });

    it("returns false for items just past 36h", () => {
      const old = new Date(now.getTime() - 36 * 60 * 60 * 1000 - 1);
      expect(isRecent(old, now)).toBe(false);
    });

    it("returns false for null publishedAt", () => {
      expect(isRecent(null, now)).toBe(false);
    });

    it("treats future-dated items as recent (clock skew tolerance)", () => {
      const future = new Date(now.getTime() + 60 * 60 * 1000);
      expect(isRecent(future, now)).toBe(true);
    });
  });

  describe("isSummaryAndTitleEmpty", () => {
    it("returns true when both null", () => {
      expect(isSummaryAndTitleEmpty(null, null)).toBe(true);
    });

    it("returns true when both whitespace", () => {
      expect(isSummaryAndTitleEmpty("   ", "\t\n")).toBe(true);
    });

    it("returns false when title present", () => {
      expect(isSummaryAndTitleEmpty("A title", null)).toBe(false);
    });

    it("returns false when summary present", () => {
      expect(isSummaryAndTitleEmpty(null, "A summary")).toBe(false);
    });

    it("returns false when both present", () => {
      expect(isSummaryAndTitleEmpty("A", "B")).toBe(false);
    });
  });

  describe("meetsLengthFloor", () => {
    it("returns true at the floor", () => {
      expect(meetsLengthFloor("a".repeat(BODY_LENGTH_FLOOR_CHARS))).toBe(true);
    });

    it("returns false one char below the floor", () => {
      expect(meetsLengthFloor("a".repeat(BODY_LENGTH_FLOOR_CHARS - 1))).toBe(false);
    });

    it("returns false on empty", () => {
      expect(meetsLengthFloor("")).toBe(false);
    });
  });

  describe("matchesNoisePattern — linkbait", () => {
    it("matches 'You won't believe' in title", () => {
      const r = matchesNoisePattern("You won't believe what happened", null);
      expect(r.match).toBe(true);
      expect(r.category).toBe("linkbait");
    });

    it("matches 'this one weird trick' at start of summary", () => {
      // Linkbait pattern uses ^ anchor — only matches at start. Embedded
      // mid-sentence usage doesn't match (12e.8 soak may relax this).
      const r = matchesNoisePattern(null, "This one weird trick will save you money");
      expect(r.match).toBe(true);
      expect(r.category).toBe("linkbait");
    });

    it("does NOT match 'this one weird trick' embedded mid-sentence", () => {
      const r = matchesNoisePattern(null, "Doctors hate this one weird trick");
      expect(r.match).toBe(false);
    });

    it("matches 'jaw-dropping' (case-insensitive)", () => {
      const r = matchesNoisePattern("JAW-DROPPING reveal", null);
      expect(r.match).toBe(true);
      expect(r.category).toBe("linkbait");
    });

    it("matches '7 things' pattern", () => {
      const r = matchesNoisePattern("7 things every investor must know", null);
      expect(r.match).toBe(true);
      expect(r.category).toBe("linkbait");
    });
  });

  describe("matchesNoisePattern — listicle", () => {
    it("matches 'Top 10 things'", () => {
      const r = matchesNoisePattern("Top 10 things to know about AI", null);
      expect(r.match).toBe(true);
      // Note: this can match either linkbait or listicle depending on priority;
      // implementation scans linkbait first.
      expect(["linkbait", "listicle"]).toContain(r.category);
    });

    it("matches '5 tips for' in title", () => {
      const r = matchesNoisePattern("5 tips for surviving the rate hike", null);
      // Same — linkbait pattern `\b\d+ (things|ways|reasons)\b` won't match 'tips';
      // listicle catches this.
      expect(r.match).toBe(true);
      expect(r.category).toBe("listicle");
    });

    it("matches 'Every X Y ranked' three-word pattern", () => {
      // Listicle pattern is restrictive: exactly two words between
      // "Every|All the" and "ranked|rated". "Every Fortune 500 CEO ranked"
      // (three words) doesn't match — soak may relax in 12e.8.
      const r = matchesNoisePattern("Every CEO publicly ranked", null);
      expect(r.match).toBe(true);
      expect(r.category).toBe("listicle");
    });

    it("matches 'All the X Y rated' two-word pattern", () => {
      const r = matchesNoisePattern("All the AI labs rated", null);
      expect(r.match).toBe(true);
      expect(r.category).toBe("listicle");
    });
  });

  describe("matchesNoisePattern — paid content", () => {
    it("matches 'sponsored content'", () => {
      const r = matchesNoisePattern("Sponsored content: A look at the future", null);
      expect(r.match).toBe(true);
      expect(r.category).toBe("paid");
    });

    it("matches 'sponsored by'", () => {
      const r = matchesNoisePattern(null, "This article is sponsored by Acme Corp");
      expect(r.match).toBe(true);
      expect(r.category).toBe("paid");
    });

    it("matches 'in partnership with' (case-insensitive)", () => {
      const r = matchesNoisePattern("In partnership with TechCo", null);
      expect(r.match).toBe(true);
      expect(r.category).toBe("paid");
    });

    it("matches 'paid post'", () => {
      const r = matchesNoisePattern("Paid post: Why X matters", null);
      expect(r.match).toBe(true);
      expect(r.category).toBe("paid");
    });
  });

  describe("matchesNoisePattern — negative cases", () => {
    it("returns no match on a normal headline", () => {
      const r = matchesNoisePattern(
        "TSMC first-quarter profit rises 58%, beats estimates as AI demand fuels record run",
        "TSMC reports Q1 results above analyst expectations.",
      );
      expect(r.match).toBe(false);
      expect(r.category).toBeUndefined();
    });

    it("returns no match when title and summary are both empty", () => {
      const r = matchesNoisePattern(null, null);
      expect(r.match).toBe(false);
    });

    it("returns no match on a generic news summary", () => {
      const r = matchesNoisePattern(
        "Apple-TSMC: The Partnership That Built Modern Semiconductors",
        "A deep dive into the strategic relationship.",
      );
      expect(r.match).toBe(false);
    });
  });

  describe("noiseCategoryToReason", () => {
    it("maps each category to its reason", () => {
      expect(noiseCategoryToReason("linkbait")).toBe(HEURISTIC_REASONS.NOISE_LINKBAIT);
      expect(noiseCategoryToReason("listicle")).toBe(HEURISTIC_REASONS.NOISE_LISTICLE);
      expect(noiseCategoryToReason("paid")).toBe(HEURISTIC_REASONS.NOISE_PAID);
    });
  });

  describe("isNonArticleUrl", () => {
    it("matches Bloomberg /news/videos/ paths", () => {
      expect(
        isNonArticleUrl("https://www.bloomberg.com/news/videos/2026-04-27/clip"),
      ).toBe(true);
    });

    it("matches the pattern case-insensitively", () => {
      expect(
        isNonArticleUrl("https://www.bloomberg.com/News/Videos/2026-04-27/clip"),
      ).toBe(true);
    });

    it("does not match Bloomberg article paths", () => {
      expect(
        isNonArticleUrl("https://www.bloomberg.com/news/articles/2026-04-27/x"),
      ).toBe(false);
    });

    it("does not match unrelated URLs", () => {
      expect(isNonArticleUrl("https://example.com/foo/bar")).toBe(false);
    });

    it("returns false for null URL", () => {
      expect(isNonArticleUrl(null)).toBe(false);
    });

    it("returns false for malformed URL", () => {
      expect(isNonArticleUrl("not-a-url")).toBe(false);
    });
  });
});
