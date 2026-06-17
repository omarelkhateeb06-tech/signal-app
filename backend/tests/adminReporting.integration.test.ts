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

const adminUserId = "11111111-1111-1111-1111-111111111111";
const otherUserId = "22222222-2222-2222-2222-222222222222";
const ORIGINAL_ADMIN = process.env.ADMIN_USER_IDS;

afterEach(() => {
  if (ORIGINAL_ADMIN === undefined) delete process.env.ADMIN_USER_IDS;
  else process.env.ADMIN_USER_IDS = ORIGINAL_ADMIN;
});

beforeEach(() => {
  mock.reset();
  process.env.ADMIN_USER_IDS = adminUserId;
});

describe("admin reporting — auth", () => {
  it("returns 401 without a token", async () => {
    const res = await request(app).get("/admin/reports/growth");
    expect(res.status).toBe(401);
  });

  it("returns 403 for a non-admin caller", async () => {
    const token = generateToken(otherUserId, "x@y.z");
    const res = await request(app).get("/admin/reports/growth").set(...auth(token));
    expect(res.status).toBe(403);
  });
});

describe("GET /admin/reports/growth", () => {
  it("reports signups, source breakdown, and completion rate", async () => {
    const token = generateToken(adminUserId, "a@b.com");
    mock.queueSelect([{ c: 40 }]); // signups in window
    mock.queueSelect([
      { source: "reddit", c: 25 },
      { source: "direct", c: 15 },
    ]); // by source
    mock.queueSelect([{ c: 200 }]); // total users
    mock.queueSelect([{ c: 150 }]); // identified

    const res = await request(app)
      .get("/admin/reports/growth?days=30")
      .set(...auth(token));

    expect(res.status).toBe(200);
    expect(res.body.data.window_days).toBe(30);
    expect(res.body.data.signups).toBe(40);
    expect(res.body.data.by_source).toEqual([
      { source: "reddit", count: 25 },
      { source: "direct", count: 15 },
    ]);
    expect(res.body.data.identified_subscribers).toBe(150);
    // 150 / 200 = 0.75
    expect(res.body.data.profile_completion_rate).toBe(0.75);
  });

  it("clamps an out-of-range days param", async () => {
    const token = generateToken(adminUserId, "a@b.com");
    mock.queueSelect([{ c: 0 }]);
    mock.queueSelect([]);
    mock.queueSelect([{ c: 0 }]);
    mock.queueSelect([{ c: 0 }]);

    const res = await request(app)
      .get("/admin/reports/growth?days=9999")
      .set(...auth(token));

    expect(res.status).toBe(200);
    expect(res.body.data.window_days).toBe(365);
  });
});

describe("GET /admin/reports/revenue", () => {
  it("computes tier counts, MRR estimate, and paid conversion", async () => {
    const token = generateToken(adminUserId, "a@b.com");
    mock.queueSelect([
      { tier: "free", c: 120 },
      { tier: "pro_trial", c: 30 },
      { tier: "pro", c: 30 },
    ]);

    const res = await request(app).get("/admin/reports/revenue").set(...auth(token));

    expect(res.status).toBe(200);
    expect(res.body.data.tiers).toEqual({ free: 120, pro_trial: 30, pro: 30 });
    expect(res.body.data.mrr_usd_estimate).toBe(300); // 30 * $10
    // pro / (free + pro) = 30 / 150 = 0.2
    expect(res.body.data.paid_conversion_rate).toBe(0.2);
  });
});

describe("GET /admin/reports/data-asset", () => {
  it("reports identified breakdowns and company completeness", async () => {
    const token = generateToken(adminUserId, "a@b.com");
    mock.queueSelect([{ c: 100 }]); // identified
    mock.queueSelect([
      { sector: "ai", c: 70 },
      { sector: "finance", c: 50 },
    ]); // by sector
    mock.queueSelect([{ role: "engineer", c: 40 }]); // by role
    mock.queueSelect([{ size: "11-50", c: 20 }]); // by company size
    mock.queueSelect([{ c: 60 }]); // with company

    const res = await request(app)
      .get("/admin/reports/data-asset")
      .set(...auth(token));

    expect(res.status).toBe(200);
    expect(res.body.data.identified_subscribers).toBe(100);
    expect(res.body.data.by_sector).toEqual([
      { sector: "ai", count: 70 },
      { sector: "finance", count: 50 },
    ]);
    expect(res.body.data.by_company_size).toEqual([{ company_size: "11-50", count: 20 }]);
    // 60 / 100 = 0.6
    expect(res.body.data.company_completeness).toBe(0.6);
  });
});

describe("GET /admin/reports/engagement", () => {
  it("reports the funnel, email open/CTOR rates, and active readers", async () => {
    const token = generateToken(adminUserId, "a@b.com");
    mock.queueSelect([
      { event_type: "signup_started", c: 100 },
      { event_type: "signup_completed", c: 60 },
      { event_type: "upgrade_viewed", c: 50 },
      { event_type: "checkout_started", c: 10 },
    ]); // funnel
    mock.queueSelect([
      { event_type: "delivered", c: 200 },
      { event_type: "open", c: 90 },
      { event_type: "click", c: 18 },
    ]); // email
    mock.queueSelect([{ c: 42 }]); // active users

    const res = await request(app)
      .get("/admin/reports/engagement?days=7")
      .set(...auth(token));

    expect(res.status).toBe(200);
    expect(res.body.data.window_days).toBe(7);
    expect(res.body.data.funnel.signup_completed).toBe(60);
    expect(res.body.data.funnel.checkout_started).toBe(10);
    // open / delivered = 90 / 200 = 0.45
    expect(res.body.data.email.open_rate).toBe(0.45);
    // click / open = 18 / 90 = 0.2
    expect(res.body.data.email.click_to_open_rate).toBe(0.2);
    expect(res.body.data.behavioral_active_users).toBe(42);
  });
});
