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

// Force the queue getters to return null — the test environment has no
// Redis configured. The admin controller should surface zeros for all
// queue depths in that case rather than 500ing.
jest.mock("../src/jobs/ingestion/enrichmentQueue", () => ({
  getEnrichmentQueue: () => null,
}));
jest.mock("../src/jobs/ingestion/sourcePollQueue", () => ({
  getSourcePollQueue: () => null,
}));

import { createApp } from "../src/app";
import { generateToken } from "../src/services/authService";

const app = createApp();

function auth(token: string): [string, string] {
  return ["Authorization", `Bearer ${token}`];
}

const adminUserId = "11111111-1111-1111-1111-111111111111";
const otherUserId = "22222222-2222-2222-2222-222222222222";
const email = "admin@example.com";

const ORIGINAL_ADMIN = process.env.ADMIN_USER_IDS;

afterEach(() => {
  if (ORIGINAL_ADMIN === undefined) delete process.env.ADMIN_USER_IDS;
  else process.env.ADMIN_USER_IDS = ORIGINAL_ADMIN;
});

describe("GET /admin/ingestion/status", () => {
  beforeEach(() => {
    mock.reset();
  });

  it("returns 401 without an auth token", async () => {
    process.env.ADMIN_USER_IDS = adminUserId;
    const res = await request(app).get("/admin/ingestion/status");
    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller is not in ADMIN_USER_IDS", async () => {
    process.env.ADMIN_USER_IDS = adminUserId;
    const token = generateToken(otherUserId, "other@x.y");
    const res = await request(app)
      .get("/admin/ingestion/status")
      .set(...auth(token));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("returns 403 when ADMIN_USER_IDS is unset", async () => {
    delete process.env.ADMIN_USER_IDS;
    const token = generateToken(adminUserId, email);
    const res = await request(app)
      .get("/admin/ingestion/status")
      .set(...auth(token));
    expect(res.status).toBe(403);
  });

  it("returns the full status payload for an admin caller", async () => {
    process.env.ADMIN_USER_IDS = adminUserId;
    const token = generateToken(adminUserId, email);

    // 1. ingestion_sources select (orderBy slug)
    mock.queueSelect([
      {
        id: "src-1",
        slug: "cnbc-markets",
        displayName: "CNBC Markets",
        adapterType: "rss",
        enabled: true,
        lastPolledAt: new Date("2026-05-03T00:00:00Z"),
        lastSuccessAt: new Date("2026-05-03T00:00:00Z"),
        consecutiveFailureCount: 0,
      },
    ]);
    // 2. candidate counts (groupBy ingestion_source_id) — 60 candidates
    //    in window with 50 rejected → rate = 50/60 = 0.83.
    mock.queueSelect([
      {
        ingestionSourceId: "src-1",
        total: 60,
        rejected: 50,
        published: 8,
      },
    ]);
    // 3. recent_failures select
    mock.queueSelect([
      {
        id: "cand-1",
        ingestionSourceId: "src-1",
        url: "https://example.com/x",
        status: "failed",
        statusReason: "facts_parse_error",
        discoveredAt: new Date("2026-05-02T00:00:00Z"),
        processedAt: new Date("2026-05-02T01:00:00Z"),
      },
    ]);
    // 4. events created count (Drizzle select)
    mock.queueSelect([{ count: 12 }]);
    // 5. event_sources attached count (Drizzle select)
    mock.queueSelect([{ count: 3 }]);

    const res = await request(app)
      .get("/admin/ingestion/status")
      .set(...auth(token));

    expect(res.status).toBe(200);
    expect(res.body.data.sources).toHaveLength(1);
    const s = res.body.data.sources[0];
    expect(s.slug).toBe("cnbc-markets");
    expect(s.consecutive_failure_count).toBe(0);
    expect(s.candidates_24h).toBe(60);
    expect(s.published_24h).toBe(8);
    expect(s.rejected_24h).toBe(50);
    // 50/60 → 0.83 (rounded to 2dp)
    expect(s.rejection_rate_24h).toBe(0.83);
    expect(s.last_success_at).toBeTruthy();
    // Queue depths reflect the null-queue case (Redis unconfigured).
    expect(res.body.data.queues.enrichment).toEqual({
      waiting: 0,
      active: 0,
      failed: 0,
    });
    expect(res.body.data.queues.source_poll).toEqual({
      waiting: 0,
      active: 0,
      failed: 0,
    });
    expect(res.body.data.recent_failures).toHaveLength(1);
    expect(res.body.data.recent_failures[0].reason).toBe("facts_parse_error");
    expect(res.body.data.cluster_stats_24h.events_created).toBe(12);
    expect(res.body.data.cluster_stats_24h.sources_attached).toBe(3);
  });

  // Phase 12e.8 — rejection_rate_24h is null when sample < 50. Small
  // samples are noisy and the kill-switch threshold (per roadmap §5.4)
  // also gates on a 50+ sample, so the admin view mirrors that floor.
  it("reports rejection_rate_24h=null when candidate sample < 50", async () => {
    process.env.ADMIN_USER_IDS = adminUserId;
    const token = generateToken(adminUserId, email);

    mock.queueSelect([
      {
        id: "src-2",
        slug: "import-ai",
        displayName: "Import AI",
        adapterType: "rss",
        enabled: true,
        lastPolledAt: new Date("2026-05-03T00:00:00Z"),
        lastSuccessAt: null,
        consecutiveFailureCount: 1,
      },
    ]);
    mock.queueSelect([
      {
        ingestionSourceId: "src-2",
        total: 12,
        rejected: 10,
        published: 2,
      },
    ]);
    mock.queueSelect([]); // recent_failures
    mock.queueSelect([{ count: 0 }]); // events created
    mock.queueSelect([{ count: 0 }]); // sources attached

    const res = await request(app)
      .get("/admin/ingestion/status")
      .set(...auth(token));

    expect(res.status).toBe(200);
    expect(res.body.data.sources[0].rejection_rate_24h).toBeNull();
    expect(res.body.data.sources[0].candidates_24h).toBe(12);
    expect(res.body.data.sources[0].last_success_at).toBeNull();
  });
});
