// Phase 12f — ranking tests.
//
// The first three cases exercise `calculateEffectiveScore` directly —
// it's the TS mirror of the SQL ORDER BY expression and the canonical
// place to assert formula correctness. Tests (a), (b), and (c) cover:
//   (a) EDGAR-without-body penalty pushes editorial above EDGAR
//   (b) freshness bonus boundary (in-window vs out-of-window)
//   (c) cluster amplification monotonically increases score
//
// Test (d) covers the sector filter at the controller level. The
// SQL WHERE clause itself can't be exercised against the mockDb chain
// (it ignores WHERE), so this test pins the controller's filter
// *selection* logic: empty user sectors → no early-return, all sectors
// flow through (a behavior change from the prior implementation).

import request from "supertest";
import { createMockDb } from "../helpers/mockDb";

const mock = createMockDb();

jest.mock("../../src/db", () => ({
  __esModule: true,
  get db() {
    return mock.db;
  },
  schema: {},
  pool: {},
}));

import { PgDialect } from "drizzle-orm/pg-core";

import { createApp } from "../../src/app";
import { generateToken } from "../../src/services/authService";
import { calculateEffectiveScore } from "../../src/feed/calculateEffectiveScore";
import { eventHasEnabledSourceExpr } from "../../src/controllers/storyController";
import {
  EDGAR_PENALTY,
  FRESHNESS_BONUS,
  FRESHNESS_QUALITY_THRESHOLD,
  FRESHNESS_WINDOW_HOURS,
  W1,
  W2,
} from "../../src/feed/rankingConstants";

const app = createApp();
const userId = "33333333-3333-3333-3333-333333333333";

function auth(token: string): [string, string] {
  return ["Authorization", `Bearer ${token}`];
}

describe("calculateEffectiveScore — Phase 12f ranking formula", () => {
  describe("(a) EDGAR-without-body penalty", () => {
    it("ranks an EDGAR-only event with empty body BELOW an editorial event of the same age and quality", () => {
      // Same quality_score and age — only difference is the EDGAR
      // gate. The editorial event should out-rank.
      const ageHours = 2;
      const editorial = calculateEffectiveScore({
        qualityScore: 9,
        sourcesAttachedCount: 0,
        ageHours,
        isEdgarSoleSource: false,
        bodyTextPresent: false, // editorial may or may not have body; penalty doesn't apply
      });
      const edgarUnenriched = calculateEffectiveScore({
        qualityScore: 9,
        sourcesAttachedCount: 0,
        ageHours,
        isEdgarSoleSource: true,
        bodyTextPresent: false, // body enrichment didn't land
      });
      expect(editorial).toBeGreaterThan(edgarUnenriched);
      // Penalty magnitude matches the constant.
      expect(editorial - edgarUnenriched).toBeCloseTo(EDGAR_PENALTY, 5);
    });

    it("does NOT apply the penalty once body enrichment lands", () => {
      const ageHours = 2;
      const editorial = calculateEffectiveScore({
        qualityScore: 9,
        sourcesAttachedCount: 0,
        ageHours,
        isEdgarSoleSource: false,
        bodyTextPresent: true,
      });
      const edgarEnriched = calculateEffectiveScore({
        qualityScore: 9,
        sourcesAttachedCount: 0,
        ageHours,
        isEdgarSoleSource: true,
        bodyTextPresent: true, // body enrichment succeeded
      });
      expect(editorial).toBeCloseTo(edgarEnriched, 5);
    });
  });

  describe("(b) freshness bonus", () => {
    it("applies when quality_score >= threshold AND age <= window", () => {
      const within = calculateEffectiveScore({
        qualityScore: FRESHNESS_QUALITY_THRESHOLD,
        sourcesAttachedCount: 0,
        ageHours: FRESHNESS_WINDOW_HOURS - 0.1,
        isEdgarSoleSource: false,
        bodyTextPresent: true,
      });
      const justOutside = calculateEffectiveScore({
        qualityScore: FRESHNESS_QUALITY_THRESHOLD,
        sourcesAttachedCount: 0,
        ageHours: FRESHNESS_WINDOW_HOURS + 0.1,
        isEdgarSoleSource: false,
        bodyTextPresent: true,
      });
      // Difference between just-inside and just-outside should equal
      // the bonus minus the small decay delta over 0.2h.
      const bonusContribution = within - justOutside;
      expect(bonusContribution).toBeGreaterThan(FRESHNESS_BONUS - 1);
      expect(bonusContribution).toBeLessThan(FRESHNESS_BONUS + 1);
    });

    it("does NOT apply when quality_score is below threshold, even if fresh", () => {
      const lowQualityFresh = calculateEffectiveScore({
        qualityScore: FRESHNESS_QUALITY_THRESHOLD - 1,
        sourcesAttachedCount: 0,
        ageHours: 0,
        isEdgarSoleSource: false,
        bodyTextPresent: true,
      });
      // Expected: just quality_score (no bonus, no decay at age 0).
      expect(lowQualityFresh).toBeCloseTo(FRESHNESS_QUALITY_THRESHOLD - 1, 5);
    });

    it("does NOT apply at age == window boundary + epsilon", () => {
      const ageJustOver = FRESHNESS_WINDOW_HOURS + 0.0001;
      const score = calculateEffectiveScore({
        qualityScore: FRESHNESS_QUALITY_THRESHOLD,
        sourcesAttachedCount: 0,
        ageHours: ageJustOver,
        isEdgarSoleSource: false,
        bodyTextPresent: true,
      });
      const expected = FRESHNESS_QUALITY_THRESHOLD - W2 * ageJustOver;
      expect(score).toBeCloseTo(expected, 5);
    });
  });

  describe("(c) cluster amplification", () => {
    it("strictly increases score as sources_attached_count grows", () => {
      const base = {
        qualityScore: 7,
        ageHours: 1,
        isEdgarSoleSource: false,
        bodyTextPresent: true,
      };
      const solo = calculateEffectiveScore({ ...base, sourcesAttachedCount: 0 });
      const oneAttached = calculateEffectiveScore({ ...base, sourcesAttachedCount: 1 });
      const threeAttached = calculateEffectiveScore({ ...base, sourcesAttachedCount: 3 });
      expect(oneAttached).toBeGreaterThan(solo);
      expect(threeAttached).toBeGreaterThan(oneAttached);
    });

    it("amplification magnitude matches W1 * ln(1 + count)", () => {
      const base = {
        qualityScore: 7,
        ageHours: 0,
        isEdgarSoleSource: false,
        bodyTextPresent: true,
      };
      const solo = calculateEffectiveScore({ ...base, sourcesAttachedCount: 0 });
      const fourAttached = calculateEffectiveScore({ ...base, sourcesAttachedCount: 4 });
      const delta = fourAttached - solo;
      expect(delta).toBeCloseTo(W1 * Math.log(1 + 4), 5);
    });
  });
});

describe("getFeed — sector filter (Phase 12f)", () => {
  beforeEach(() => {
    mock.reset();
  });

  it("(d) when the user has no sectors set, does NOT short-circuit to empty — returns events instead", async () => {
    const token = generateToken(userId, "user@example.com");

    // requireProfile lookup — return a completed profile with NO sectors.
    mock.queueSelect([{ completedAt: new Date("2026-04-01T00:00:00Z") }]);
    // getFeed profile lookup — sectors=[], role=null.
    mock.queueSelect([{ sectors: [], role: null }]);
    // stories query (chronological).
    mock.queueSelect([]);
    // events query (ranked) — return one event of sector 'ai' and one of
    // sector 'finance'. With the prior behavior (early-return on empty
    // sectorsFilter), neither would appear; with the 12f behavior, both
    // pass the no-filter path.
    mock.queueSelect([
      {
        id: "11111111-1111-1111-1111-111111111111",
        sector: "ai",
        headline: "An AI event",
        context: "ctx",
        whyItMatters: "wim",
        whyItMattersTemplate: null,
        primarySourceUrl: "https://example.com/a",
        primarySourceName: "Example AI",
        publishedAt: new Date("2026-05-04T00:00:00Z"),
        createdAt: new Date("2026-05-04T00:00:00Z"),
        authorId: null,
        authorName: null,
        authorBio: null,
        isSaved: false,
        saveCount: 0,
        commentCount: 0,
        effectiveScore: 8.5,
      },
      {
        id: "22222222-2222-2222-2222-222222222222",
        sector: "finance",
        headline: "A finance event",
        context: "ctx",
        whyItMatters: "wim",
        whyItMattersTemplate: null,
        primarySourceUrl: "https://example.com/f",
        primarySourceName: "Example Fin",
        publishedAt: new Date("2026-05-04T00:00:00Z"),
        createdAt: new Date("2026-05-04T00:00:00Z"),
        authorId: null,
        authorName: null,
        authorBio: null,
        isSaved: false,
        saveCount: 0,
        commentCount: 0,
        effectiveScore: 7.0,
      },
    ]);
    // event_sources batch fetch (for the two ids on the page).
    mock.queueSelect([]);
    // storiesCountRow.
    mock.queueSelect([{ count: 0 }]);
    // eventsCountRow.
    mock.queueSelect([{ count: 2 }]);

    const res = await request(app)
      .get("/api/v1/stories/feed")
      .set(...auth(token));

    expect(res.status).toBe(200);
    expect(res.body.data.stories).toHaveLength(2);
    // Verify both sectors flow through — the empty-sectors path is
    // "return all," not "return none."
    const sectors = (res.body.data.stories as Array<{ sector: string }>)
      .map((s) => s.sector)
      .sort();
    expect(sectors).toEqual(["ai", "finance"]);
  });

  it("ranks the higher-effective_score event above the lower one in the merged page", async () => {
    const token = generateToken(userId, "user@example.com");
    mock.queueSelect([{ completedAt: new Date("2026-04-01T00:00:00Z") }]);
    mock.queueSelect([{ sectors: ["ai"], role: null }]);
    mock.queueSelect([]);
    // Two events with different effectiveScore — verify the merge
    // sorts by score DESC.
    mock.queueSelect([
      {
        id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        sector: "ai",
        headline: "Lower-score event",
        context: "ctx",
        whyItMatters: "wim",
        whyItMattersTemplate: null,
        primarySourceUrl: "https://example.com/lo",
        primarySourceName: null,
        publishedAt: new Date("2026-05-04T00:00:00Z"),
        createdAt: new Date("2026-05-04T00:00:00Z"),
        authorId: null,
        authorName: null,
        authorBio: null,
        isSaved: false,
        saveCount: 0,
        commentCount: 0,
        effectiveScore: 3.0,
      },
      {
        id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        sector: "ai",
        headline: "Higher-score event",
        context: "ctx",
        whyItMatters: "wim",
        whyItMattersTemplate: null,
        primarySourceUrl: "https://example.com/hi",
        primarySourceName: null,
        publishedAt: new Date("2026-05-04T00:00:00Z"),
        createdAt: new Date("2026-05-04T00:00:00Z"),
        authorId: null,
        authorName: null,
        authorBio: null,
        isSaved: false,
        saveCount: 0,
        commentCount: 0,
        effectiveScore: 11.5,
      },
    ]);
    mock.queueSelect([]);
    mock.queueSelect([{ count: 0 }]);
    mock.queueSelect([{ count: 2 }]);

    const res = await request(app)
      .get("/api/v1/stories/feed")
      .set(...auth(token));

    expect(res.status).toBe(200);
    const headlines = (res.body.data.stories as Array<{ headline: string }>).map(
      (s) => s.headline,
    );
    expect(headlines).toEqual(["Higher-score event", "Lower-score event"]);
  });
});

// Hotfix (GH #88) — the feed query now also filters out events whose
// every source is currently disabled (`ingestion_sources.enabled =
// false`). This is a WHERE-clause predicate composed into the events
// query alongside the sector filter. The mockDb chain doesn't apply
// WHERE, so we test the SQL fragment directly via PgDialect.sqlToQuery
// — verifying the builder produces the expected `EXISTS (... enabled
// = true ...)` predicate. Behavior at the live-DB layer is a function
// of that fragment plus Postgres semantics.
describe("eventHasEnabledSourceExpr — disabled-source filter (hotfix #88)", () => {
  it("produces an EXISTS subquery joining event_sources and ingestion_sources with enabled = true", () => {
    const dialect = new PgDialect();
    const { sql: rendered } = dialect.sqlToQuery(eventHasEnabledSourceExpr());

    // Whitespace-collapse for resilient substring assertions.
    const collapsed = rendered.replace(/\s+/g, " ").toLowerCase();

    expect(collapsed).toContain("exists");
    expect(collapsed).toContain("event_sources");
    expect(collapsed).toContain("ingestion_sources");
    expect(collapsed).toMatch(/s\.enabled\s*=\s*true/);
    // The subquery is correlated on the outer events row.
    expect(collapsed).toContain("es.event_id");
  });

  it("getFeed filters events when the SQL-side filter has already excluded the disabled-source rows", async () => {
    // mockDb can't enforce the WHERE itself — but the test still
    // documents the contract end-to-end: the controller takes the
    // post-filter events result from the DB and emits exactly those
    // rows on the wire. If the SQL filter were ever dropped, the
    // PgDialect test above would still pass on the helper, but a
    // future integration test against a real Postgres would catch
    // the regression.
    const token = generateToken(userId, "user@example.com");
    mock.queueSelect([{ completedAt: new Date("2026-04-01T00:00:00Z") }]);
    mock.queueSelect([{ sectors: ["ai"], role: null }]);
    mock.queueSelect([]); // stories
    // events: the SQL filter would have excluded any disabled-source
    // events; we return only the surviving enabled-source event.
    mock.queueSelect([
      {
        id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
        sector: "ai",
        headline: "Enabled-source event",
        context: "ctx",
        whyItMatters: "wim",
        whyItMattersTemplate: null,
        primarySourceUrl: "https://example.com/a",
        primarySourceName: "Editorial",
        publishedAt: new Date("2026-05-12T00:00:00Z"),
        createdAt: new Date("2026-05-12T00:00:00Z"),
        authorId: null,
        authorName: null,
        authorBio: null,
        isSaved: false,
        saveCount: 0,
        commentCount: 0,
        effectiveScore: 8.0,
      },
    ]);
    mock.queueSelect([]); // event_sources batch
    mock.queueSelect([{ count: 0 }]); // stories count
    mock.queueSelect([{ count: 1 }]); // events count (post-filter)

    const res = await request(app)
      .get("/api/v1/stories/feed")
      .set(...auth(token));

    expect(res.status).toBe(200);
    expect(res.body.data.stories).toHaveLength(1);
    expect(res.body.data.stories[0].headline).toBe("Enabled-source event");
  });
});
