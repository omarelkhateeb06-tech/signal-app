import request from "supertest";
import { createMockDb } from "./helpers/mockDb";

const mock = createMockDb();

jest.mock("../src/db", () => ({
  __esModule: true,
  get db() {
    return mock.db;
  },
  schema: {},
  pool: {},
}));

import { createApp } from "../src/app";
import { generateToken } from "../src/services/authService";

const app = createApp();

function auth(token: string): [string, string] {
  return ["Authorization", `Bearer ${token}`];
}

const userId = "user-1";
const email = "reader@example.com";
const storyId = "11111111-1111-1111-1111-111111111111";

function makeRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: storyId,
    sector: "ai",
    headline: "New frontier model released",
    context: "Context text.",
    whyItMatters: "Costs fall.",
    whyItMattersTemplate: null,
    sourceUrl: "https://example.com/post",
    sourceName: "Example",
    publishedAt: new Date("2026-04-01T00:00:00Z"),
    createdAt: new Date("2026-04-01T00:00:00Z"),
    authorId: "author-1",
    authorName: "Jane Writer",
    authorBio: "Bio",
    isSaved: false,
    saveCount: 3,
    commentCount: 1,
    ...overrides,
  };
}

// Phase 12m — the feed is events-only. Feed tests stage event-shaped
// rows (the column set the events query SELECTs); `effectiveScore`
// drives the in-memory ranking sort. `makeRow` (story shape) is still
// used by the non-feed endpoints (detail / saves / related) below.
const eventId = "33333333-3333-3333-3333-333333333333";

function makeEventRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: eventId,
    sector: "ai",
    headline: "New frontier model released",
    context: "Context text.",
    whyItMatters: "Costs fall.",
    whyItMattersTemplate: null,
    genericCommentary: null,
    primarySourceUrl: "https://example.com/post",
    primarySourceName: "Example",
    imageUrl: null,
    publishedAt: new Date("2026-04-01T00:00:00Z"),
    createdAt: new Date("2026-04-01T00:00:00Z"),
    authorId: "author-1",
    authorName: "Jane Writer",
    authorBio: "Bio",
    isSaved: false,
    saveCount: 3,
    commentCount: 1,
    effectiveScore: 8,
    ...overrides,
  };
}

describe("stories endpoints", () => {
  let token: string;

  beforeEach(() => {
    mock.reset();
    token = generateToken(userId, email);
  });

  // Phase 12b: /feed and /search are guarded by requireProfile, which
  // runs a SELECT on userProfiles.completedAt before the controller
  // executes. Every authorized-path test must queue the onboarded
  // sentinel first.
  const queueOnboarded = (): void => {
    mock.queueSelect([{ completedAt: new Date("2026-04-20T00:00:00Z") }]);
  };

  // Phase 12g: getFeed and getStoryById both resolve the effective
  // tier via a users-row SELECT immediately after requireProfile (feed)
  // or as the first DB call (detail). Tests that don't exercise the
  // free-tier gating default to `pro` so the paywall path is skipped —
  // pro users never call Redis or the gate builder.
  const queueTierPro = (): void => {
    mock.queueSelect([{ tier: "pro", trialStartedAt: null }]);
  };

  describe("GET /api/v1/stories/feed", () => {
    it("returns 401 without a token", async () => {
      const res = await request(app).get("/api/v1/stories/feed");
      expect(res.status).toBe(401);
    });

    it("returns empty feed when user has no sectors and none are requested", async () => {
      queueOnboarded();
      queueTierPro();
      mock.queueSelect([{ sectors: [], role: "engineer" }]);

      const res = await request(app)
        .get("/api/v1/stories/feed")
        .set(...auth(token));

      expect(res.status).toBe(200);
      expect(res.body.data.stories).toEqual([]);
      expect(res.body.data.total).toBe(0);
      expect(res.body.data.has_more).toBe(false);
    });

    it("uses the user's profile sectors when query is empty", async () => {
      queueOnboarded();
      queueTierPro();
      mock.queueSelect([{ sectors: ["ai"], role: "engineer" }]);
      // Phase 12m — feed is events-only: events query → event_sources
      // batch (one round-trip when the page is non-empty) → events count.
      mock.queueSelect([makeEventRow()]);
      mock.queueSelect([]); // event_sources batch — none
      mock.queueSelect([{ count: 1 }]); // events count

      const res = await request(app)
        .get("/api/v1/stories/feed")
        .set(...auth(token));

      expect(res.status).toBe(200);
      expect(res.body.data.stories).toHaveLength(1);
      expect(res.body.data.stories[0].sector).toBe("ai");
      expect(res.body.data.stories[0].why_it_matters_to_you).toContain(
        "As an engineer",
      );
      expect(res.body.data.total).toBe(1);
      expect(res.body.data.has_more).toBe(false);
    });

    it("filters by query sectors when provided", async () => {
      queueOnboarded();
      queueTierPro();
      mock.queueSelect([{ sectors: ["ai"], role: "vc" }]);
      mock.queueSelect([makeEventRow({ sector: "finance" })]);
      mock.queueSelect([]); // event_sources batch — none
      mock.queueSelect([{ count: 1 }]); // events count

      const res = await request(app)
        .get("/api/v1/stories/feed?sectors=finance")
        .set(...auth(token));

      expect(res.status).toBe(200);
      expect(res.body.data.stories[0].sector).toBe("finance");
      expect(res.body.data.stories[0].why_it_matters_to_you).toContain(
        "As an investor",
      );
    });

    it("reports has_more when offset+rows < total", async () => {
      queueOnboarded();
      queueTierPro();
      mock.queueSelect([{ sectors: ["ai"], role: "engineer" }]);
      mock.queueSelect([
        makeEventRow(),
        makeEventRow({ id: "22222222-2222-2222-2222-222222222222" }),
      ]);
      mock.queueSelect([]); // event_sources batch — none
      mock.queueSelect([{ count: 10 }]); // events count

      const res = await request(app)
        .get("/api/v1/stories/feed?limit=2&offset=0")
        .set(...auth(token));

      expect(res.status).toBe(200);
      expect(res.body.data.stories).toHaveLength(2);
      expect(res.body.data.total).toBe(10);
      expect(res.body.data.has_more).toBe(true);
      expect(res.body.data.limit).toBe(2);
      expect(res.body.data.offset).toBe(0);
    });

    // Phase 12m — events-only ranking. Verifies that the event with the
    // higher effective_score lands first (the 12f sort key replaced the
    // pre-12f published_at DESC sort), regardless of the order the SQL
    // returned them in, and that event_sources are batched + attached to
    // the right event on the wire shape. Converted from the pre-12m
    // dual-read merge test when the legacy `stories` leg was removed
    // from the feed.
    it("ranks events by effective_score DESC and attaches sources", async () => {
      queueOnboarded();
      queueTierPro();
      mock.queueSelect([{ sectors: ["ai"], role: "engineer" }]);
      const lowerEventId = "44444444-4444-4444-4444-444444444444";
      // events query: lower-ranked row staged FIRST to prove the
      // in-memory sort — not the staged order — decides the page order.
      mock.queueSelect([
        makeEventRow({
          id: lowerEventId,
          headline: "Lower-ranked event",
          primarySourceUrl: "https://lower.example.com",
          primarySourceName: "Lower Source",
          effectiveScore: 7,
        }),
        makeEventRow({
          id: eventId,
          headline: "Higher-ranked event",
          primarySourceUrl: "https://primary.example.com",
          primarySourceName: "Primary Source",
          effectiveScore: 9.5,
        }),
      ]);
      // event_sources batch: two rows for the higher event (primary +
      // alternate); the lower event has no source rows.
      mock.queueSelect([
        {
          eventId,
          url: "https://primary.example.com",
          name: "Primary Source",
          role: "primary",
        },
        {
          eventId,
          url: "https://alternate.example.com",
          name: "Alternate Source",
          role: "alternate",
        },
      ]);
      mock.queueSelect([{ count: 2 }]); // events count

      const res = await request(app)
        .get("/api/v1/stories/feed")
        .set(...auth(token));

      expect(res.status).toBe(200);
      expect(res.body.data.stories).toHaveLength(2);
      // Higher-ranked event lands first (effective_score 9.5 vs. 7).
      expect(res.body.data.stories[0].id).toBe(eventId);
      expect(res.body.data.stories[0].headline).toBe("Higher-ranked event");
      expect(res.body.data.stories[0].sources).toHaveLength(2);
      expect(res.body.data.stories[0].primary_source_url).toBe(
        "https://primary.example.com",
      );
      // Lower-ranked event second; no event_sources rows → empty array.
      expect(res.body.data.stories[1].id).toBe(lowerEventId);
      expect(res.body.data.stories[1].headline).toBe("Lower-ranked event");
      expect(res.body.data.stories[1].sources).toHaveLength(0);
      expect(res.body.data.total).toBe(2);
      expect(res.body.data.has_more).toBe(false);
    });

    it("rejects invalid limit values", async () => {
      queueOnboarded();
      const res = await request(app)
        .get("/api/v1/stories/feed?limit=0")
        .set(...auth(token));
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_INPUT");
    });

    it("returns 403 ONBOARDING_REQUIRED when the user has no profile row", async () => {
      mock.queueSelect([]); // requireProfile select: none
      const res = await request(app)
        .get("/api/v1/stories/feed")
        .set(...auth(token));
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("ONBOARDING_REQUIRED");
    });

    it("returns 403 ONBOARDING_REQUIRED when completed_at is null", async () => {
      mock.queueSelect([{ completedAt: null }]); // partial profile
      const res = await request(app)
        .get("/api/v1/stories/feed")
        .set(...auth(token));
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("ONBOARDING_REQUIRED");
    });
  });

  describe("GET /api/v1/stories/:id", () => {
    it("returns 401 without a token", async () => {
      const res = await request(app).get(`/api/v1/stories/${storyId}`);
      expect(res.status).toBe(401);
    });

    it("returns 400 for invalid UUID", async () => {
      const res = await request(app)
        .get("/api/v1/stories/not-a-uuid")
        .set(...auth(token));
      expect(res.status).toBe(400);
    });

    it("returns 404 when story is missing (and events fallback also misses)", async () => {
      queueTierPro();
      mock.queueSelect([{ role: "engineer" }]);
      mock.queueSelect([]); // story lookup miss
      mock.queueSelect([]); // Phase 12e.7a — events fallback miss

      const res = await request(app)
        .get(`/api/v1/stories/${storyId}`)
        .set(...auth(token));

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("STORY_NOT_FOUND");
    });

    // Phase 12e.7a — events fallback. When the id names an
    // ingestion-written event (no row in `stories`), the controller
    // falls back to the `events` table and returns the shaped event
    // with its event_sources array.
    it("returns event from the fallback path with multi-source attribution", async () => {
      const eventId = "44444444-4444-4444-4444-444444444444";
      queueTierPro();
      mock.queueSelect([{ role: "engineer" }]);
      mock.queueSelect([]); // story lookup miss
      mock.queueSelect([
        {
          id: eventId,
          sector: "semiconductors",
          headline: "TSMC pulls in 2nm",
          context: "Context.",
          whyItMatters: "Costs fall.",
          whyItMattersTemplate: null,
          primarySourceUrl: "https://primary.example.com",
          primarySourceName: "Primary",
          publishedAt: new Date("2026-04-12T00:00:00Z"),
          createdAt: new Date("2026-04-12T00:00:00Z"),
          authorId: null,
          authorName: null,
          authorBio: null,
          isSaved: false,
          saveCount: 0,
          commentCount: 0,
        },
      ]);
      mock.queueSelect([
        {
          url: "https://primary.example.com",
          name: "Primary",
          role: "primary",
        },
        {
          url: "https://alt.example.com",
          name: "Alt",
          role: "alternate",
        },
      ]);

      const res = await request(app)
        .get(`/api/v1/stories/${eventId}`)
        .set(...auth(token));

      expect(res.status).toBe(200);
      expect(res.body.data.story.id).toBe(eventId);
      expect(res.body.data.story.headline).toBe("TSMC pulls in 2nm");
      expect(res.body.data.story.sources).toHaveLength(2);
      expect(res.body.data.story.primary_source_url).toBe(
        "https://primary.example.com",
      );
      expect(res.body.data.story.why_it_matters_to_you).toContain(
        "As an engineer",
      );
    });

    it("returns the story with personalized why_it_matters_to_you", async () => {
      queueTierPro();
      mock.queueSelect([{ role: "founder" }]);
      mock.queueSelect([
        makeRow({
          whyItMattersTemplate: "{role_phrase} — so this is actionable.",
        }),
      ]);

      const res = await request(app)
        .get(`/api/v1/stories/${storyId}`)
        .set(...auth(token));

      expect(res.status).toBe(200);
      expect(res.body.data.story.id).toBe(storyId);
      expect(res.body.data.story.why_it_matters_to_you).toContain("As a founder");
      expect(res.body.data.story.why_it_matters_to_you).toContain(
        "so this is actionable",
      );
      expect(res.body.data.story.author).toEqual({
        id: "author-1",
        name: "Jane Writer",
        bio: "Bio",
      });
    });
  });

  // Phase 12q — getRelatedStories was rewritten to query `events`.
  // Anchor lookup tries `stories` first, then `events` (dual-table
  // pattern matching getStoryById). Related content is fetched from
  // `events` with a sources batch-fetch, shaped via shapeEvent.
  describe("GET /api/v1/stories/:id/related", () => {
    it("returns 401 without a token", async () => {
      const res = await request(app).get(`/api/v1/stories/${storyId}/related`);
      expect(res.status).toBe(401);
    });

    it("returns 404 when neither stories nor events contains the id", async () => {
      mock.queueSelect([]); // stories anchor miss
      mock.queueSelect([]); // events anchor miss

      const res = await request(app)
        .get(`/api/v1/stories/${storyId}/related`)
        .set(...auth(token));

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("STORY_NOT_FOUND");
    });

    it("returns same-sector events when anchor is a legacy story id", async () => {
      mock.queueSelect([{ id: storyId, sector: "ai" }]); // stories anchor found
      mock.queueSelect([{ role: "engineer" }]);           // profile
      mock.queueSelect([                                  // related events
        makeEventRow({ id: "22222222-2222-2222-2222-222222222222" }),
        makeEventRow({ id: "44444444-4444-4444-4444-444444444444" }),
      ]);
      mock.queueSelect([]);                               // event_sources batch

      const res = await request(app)
        .get(`/api/v1/stories/${storyId}/related`)
        .set(...auth(token));

      expect(res.status).toBe(200);
      expect(res.body.data.stories).toHaveLength(2);
      expect(res.body.data.stories[0].id).not.toBe(storyId);
      expect(res.body.data.stories[0].why_it_matters_to_you).toContain(
        "As an engineer",
      );
    });

    it("returns same-sector events when anchor is an event id", async () => {
      mock.queueSelect([]);                                     // stories anchor miss
      mock.queueSelect([{ id: eventId, sector: "finance" }]);  // events anchor found
      mock.queueSelect([{ role: "analyst" }]);                  // profile
      mock.queueSelect([                                        // related events
        makeEventRow({ id: storyId, sector: "finance" }),
      ]);
      mock.queueSelect([]);                                     // event_sources batch

      const res = await request(app)
        .get(`/api/v1/stories/${eventId}/related`)
        .set(...auth(token));

      expect(res.status).toBe(200);
      expect(res.body.data.stories).toHaveLength(1);
      expect(res.body.data.stories[0].sector).toBe("finance");
      expect(res.body.data.stories[0].why_it_matters_to_you).toContain(
        "As an analyst",
      );
    });
  });
});
