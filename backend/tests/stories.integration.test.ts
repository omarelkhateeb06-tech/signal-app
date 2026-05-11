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

  describe("GET /api/v1/stories/feed", () => {
    it("returns 401 without a token", async () => {
      const res = await request(app).get("/api/v1/stories/feed");
      expect(res.status).toBe(401);
    });

    it("returns empty feed when user has no sectors and none are requested", async () => {
      queueOnboarded();
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
      mock.queueSelect([{ sectors: ["ai"], role: "engineer" }]);
      mock.queueSelect([makeRow()]);
      // Phase 12e.7a — getFeed does a dual-read across stories + events,
      // batched event_sources, then a count per table. Empty events
      // returns mean the event_sources fetch is skipped (controller
      // guards on eventIds.length > 0).
      mock.queueSelect([]); // events query — empty
      mock.queueSelect([{ count: 1 }]); // stories count
      mock.queueSelect([{ count: 0 }]); // events count

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
      mock.queueSelect([{ sectors: ["ai"], role: "vc" }]);
      mock.queueSelect([makeRow({ sector: "finance" })]);
      mock.queueSelect([]); // events query — empty
      mock.queueSelect([{ count: 1 }]); // stories count
      mock.queueSelect([{ count: 0 }]); // events count

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
      mock.queueSelect([{ sectors: ["ai"], role: "engineer" }]);
      mock.queueSelect([makeRow(), makeRow({ id: "22222222-2222-2222-2222-222222222222" })]);
      mock.queueSelect([]); // events query — empty
      mock.queueSelect([{ count: 10 }]); // stories count
      mock.queueSelect([{ count: 0 }]); // events count

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

    // Phase 12e.7a / 12f — dual-read merged sort. Verifies that an
    // event with a higher effective_score lands first in the merged
    // page (the 12f sort key replaced the pre-12f published_at DESC
    // sort), event_sources are batched + attached, and multi-source
    // attribution surfaces on the wire shape of both event items and
    // legacy story items.
    it("merges stories + events sorted by effective_score DESC and attaches sources", async () => {
      queueOnboarded();
      mock.queueSelect([{ sectors: ["ai"], role: "engineer" }]);
      // stories: one row — legacy stories sort against the
      // STORY_BASELINE_EFFECTIVE_SCORE constant (currently 7).
      mock.queueSelect([makeRow({ headline: "Lower-ranked story" })]);
      // events: one row with effective_score 9.5 — should land first.
      const eventId = "33333333-3333-3333-3333-333333333333";
      mock.queueSelect([
        {
          id: eventId,
          sector: "ai",
          headline: "Higher-ranked event",
          context: "Event context",
          whyItMatters: "Event WIM",
          whyItMattersTemplate: null,
          primarySourceUrl: "https://primary.example.com",
          primarySourceName: "Primary Source",
          publishedAt: new Date("2026-04-10T00:00:00Z"),
          createdAt: new Date("2026-04-10T00:00:00Z"),
          authorId: null,
          authorName: null,
          authorBio: null,
          isSaved: false,
          saveCount: 0,
          commentCount: 0,
          effectiveScore: 9.5,
        },
      ]);
      // event_sources batch: two rows for the one event (primary + alternate)
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
      mock.queueSelect([{ count: 1 }]); // stories count
      mock.queueSelect([{ count: 1 }]); // events count

      const res = await request(app)
        .get("/api/v1/stories/feed")
        .set(...auth(token));

      expect(res.status).toBe(200);
      expect(res.body.data.stories).toHaveLength(2);
      // Higher-ranked event lands first (effective_score 9.5 vs. story baseline 7).
      expect(res.body.data.stories[0].id).toBe(eventId);
      expect(res.body.data.stories[0].headline).toBe("Higher-ranked event");
      expect(res.body.data.stories[0].sources).toHaveLength(2);
      expect(res.body.data.stories[0].primary_source_url).toBe(
        "https://primary.example.com",
      );
      // Story second; legacy stories carry a synthetic single-element sources array.
      expect(res.body.data.stories[1].headline).toBe("Lower-ranked story");
      expect(res.body.data.stories[1].sources).toHaveLength(1);
      expect(res.body.data.stories[1].sources[0].role).toBe("primary");
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

  describe("GET /api/v1/stories/:id/related", () => {
    it("returns 401 without a token", async () => {
      const res = await request(app).get(`/api/v1/stories/${storyId}/related`);
      expect(res.status).toBe(401);
    });

    it("returns 404 when base story is missing", async () => {
      mock.queueSelect([]);

      const res = await request(app)
        .get(`/api/v1/stories/${storyId}/related`)
        .set(...auth(token));

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("STORY_NOT_FOUND");
    });

    it("returns same-sector stories excluding the current one", async () => {
      mock.queueSelect([{ id: storyId, sector: "ai" }]);
      mock.queueSelect([{ role: "engineer" }]);
      mock.queueSelect([
        makeRow({ id: "22222222-2222-2222-2222-222222222222" }),
        makeRow({ id: "33333333-3333-3333-3333-333333333333" }),
      ]);

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
  });
});
