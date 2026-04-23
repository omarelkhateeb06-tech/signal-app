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
const secondStoryId = "22222222-2222-2222-2222-222222222222";

function makeRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: storyId,
    sector: "ai",
    headline: "Reasoning models reshape inference economics",
    context: "New frontier models lower per-token costs.",
    whyItMatters: "Costs fall for builders.",
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
    rank: 0.42,
    ...overrides,
  };
}

describe("GET /api/v1/stories/search", () => {
  let token: string;

  beforeEach(() => {
    mock.reset();
    token = generateToken(userId, email);
  });

  // Phase 12b: /search is guarded by requireProfile; every
  // authenticated test must queue the onboarded sentinel first.
  const queueOnboarded = (): void => {
    mock.queueSelect([{ completedAt: new Date("2026-04-20T00:00:00Z") }]);
  };

  it("returns 401 without a token", async () => {
    const res = await request(app).get("/api/v1/stories/search?q=models");
    expect(res.status).toBe(401);
  });

  it("rejects queries shorter than 2 characters", async () => {
    queueOnboarded();
    const res = await request(app)
      .get("/api/v1/stories/search?q=a")
      .set(...auth(token));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_INPUT");
  });

  it("rejects a missing query", async () => {
    queueOnboarded();
    const res = await request(app)
      .get("/api/v1/stories/search")
      .set(...auth(token));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_INPUT");
  });

  it("returns relevant stories with personalized why_it_matters_to_you", async () => {
    queueOnboarded();
    mock.queueSelect([{ role: "engineer" }]);
    mock.queueSelect([makeRow(), makeRow({ id: secondStoryId, rank: 0.2 })]);
    mock.queueSelect([{ count: 2 }]);

    const res = await request(app)
      .get("/api/v1/stories/search?q=reasoning")
      .set(...auth(token));

    expect(res.status).toBe(200);
    expect(res.body.data.stories).toHaveLength(2);
    expect(res.body.data.total).toBe(2);
    expect(res.body.data.has_more).toBe(false);
    expect(res.body.data.query).toBe("reasoning");
    expect(res.body.data.stories[0].why_it_matters_to_you).toContain(
      "As an engineer",
    );
    expect(typeof res.body.data.stories[0].rank).toBe("number");
  });

  it("accepts sector, date, and sort filters", async () => {
    queueOnboarded();
    mock.queueSelect([{ role: "vc" }]);
    mock.queueSelect([makeRow({ sector: "finance" })]);
    mock.queueSelect([{ count: 1 }]);

    const res = await request(app)
      .get(
        "/api/v1/stories/search?q=rates&sector=finance&from_date=2026-01-01&to_date=2026-12-31&sort=newest",
      )
      .set(...auth(token));

    expect(res.status).toBe(200);
    expect(res.body.data.stories).toHaveLength(1);
    expect(res.body.data.stories[0].sector).toBe("finance");
    expect(res.body.data.stories[0].why_it_matters_to_you).toContain(
      "As an investor",
    );
  });

  it("supports most_saved sort", async () => {
    queueOnboarded();
    mock.queueSelect([{ role: "analyst" }]);
    mock.queueSelect([makeRow()]);
    mock.queueSelect([{ count: 1 }]);

    const res = await request(app)
      .get("/api/v1/stories/search?q=models&sort=most_saved")
      .set(...auth(token));

    expect(res.status).toBe(200);
    expect(res.body.data.stories).toHaveLength(1);
  });

  it("handles phrase queries with quoted input", async () => {
    queueOnboarded();
    mock.queueSelect([{ role: "engineer" }]);
    mock.queueSelect([makeRow()]);
    mock.queueSelect([{ count: 1 }]);

    const res = await request(app)
      .get(`/api/v1/stories/search?q=${encodeURIComponent('"reasoning models"')}`)
      .set(...auth(token));

    expect(res.status).toBe(200);
    expect(res.body.data.stories).toHaveLength(1);
    expect(res.body.data.query).toBe('"reasoning models"');
  });

  it("paginates and reports has_more correctly", async () => {
    queueOnboarded();
    mock.queueSelect([{ role: "engineer" }]);
    mock.queueSelect([makeRow(), makeRow({ id: secondStoryId })]);
    mock.queueSelect([{ count: 12 }]);

    const res = await request(app)
      .get("/api/v1/stories/search?q=models&limit=2&offset=0")
      .set(...auth(token));

    expect(res.status).toBe(200);
    expect(res.body.data.limit).toBe(2);
    expect(res.body.data.offset).toBe(0);
    expect(res.body.data.total).toBe(12);
    expect(res.body.data.has_more).toBe(true);
  });

  it("rejects invalid sort values", async () => {
    queueOnboarded();
    const res = await request(app)
      .get("/api/v1/stories/search?q=models&sort=banana")
      .set(...auth(token));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_INPUT");
  });

  it("returns an empty result set without erroring", async () => {
    queueOnboarded();
    mock.queueSelect([{ role: "engineer" }]);
    mock.queueSelect([]);
    mock.queueSelect([{ count: 0 }]);

    const res = await request(app)
      .get("/api/v1/stories/search?q=nothinghere")
      .set(...auth(token));

    expect(res.status).toBe(200);
    expect(res.body.data.stories).toEqual([]);
    expect(res.body.data.total).toBe(0);
    expect(res.body.data.has_more).toBe(false);
  });
});
