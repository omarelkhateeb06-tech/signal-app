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

const app = createApp();

describe("POST /api/v1/emails/webhook (SendGrid Event Webhook)", () => {
  const originalToken = process.env.SENDGRID_WEBHOOK_TOKEN;

  beforeEach(() => {
    mock.reset();
    delete process.env.SENDGRID_WEBHOOK_TOKEN;
  });

  afterEach(() => {
    if (originalToken === undefined) delete process.env.SENDGRID_WEBHOOK_TOKEN;
    else process.env.SENDGRID_WEBHOOK_TOKEN = originalToken;
  });

  it("accepts a batch and maps the event fields", async () => {
    const res = await request(app)
      .post("/api/v1/emails/webhook")
      .send([
        {
          email: "a@b.com",
          event: "open",
          sg_event_id: "evt-1",
          sg_message_id: "msg-1",
          timestamp: 1_750_000_000,
          category: ["digest", "daily"],
        },
        {
          email: "a@b.com",
          event: "click",
          sg_event_id: "evt-2",
          url: "https://signal.so/stories/x",
          timestamp: 1_750_000_005,
          category: "digest",
        },
      ]);

    expect(res.status).toBe(200);
    expect(res.body.data.accepted).toBe(2);

    const rows = mock.state.insertedValues[0] as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      email: "a@b.com",
      eventType: "open",
      sgEventId: "evt-1",
      sgMessageId: "msg-1",
      categories: ["digest", "daily"],
    });
    // SendGrid unix-seconds timestamp → JS Date (ms).
    expect(rows[0].occurredAt).toEqual(new Date(1_750_000_000 * 1000));
    // A bare-string category normalizes to a single-element array.
    expect(rows[1]).toMatchObject({
      eventType: "click",
      url: "https://signal.so/stories/x",
      categories: ["digest"],
    });
  });

  it("accepts an empty batch (200, accepted 0)", async () => {
    const res = await request(app).post("/api/v1/emails/webhook").send([]);
    expect(res.status).toBe(200);
    expect(res.body.data.accepted).toBe(0);
    expect(mock.state.insertedValues).toHaveLength(0);
  });

  it("rejects a non-array body (400)", async () => {
    const res = await request(app)
      .post("/api/v1/emails/webhook")
      .send({ email: "a@b.com", event: "open" });
    expect(res.status).toBe(400);
  });

  it("requires the token when SENDGRID_WEBHOOK_TOKEN is set", async () => {
    process.env.SENDGRID_WEBHOOK_TOKEN = "s3cret";

    const missing = await request(app)
      .post("/api/v1/emails/webhook")
      .send([{ email: "a@b.com", event: "open", sg_event_id: "e" }]);
    expect(missing.status).toBe(401);

    const wrong = await request(app)
      .post("/api/v1/emails/webhook?token=nope")
      .send([{ email: "a@b.com", event: "open", sg_event_id: "e" }]);
    expect(wrong.status).toBe(401);

    const ok = await request(app)
      .post("/api/v1/emails/webhook?token=s3cret")
      .send([{ email: "a@b.com", event: "open", sg_event_id: "e" }]);
    expect(ok.status).toBe(200);
  });

  it("accepts without a token when SENDGRID_WEBHOOK_TOKEN is unset (fail-open)", async () => {
    const res = await request(app)
      .post("/api/v1/emails/webhook")
      .send([{ email: "a@b.com", event: "delivered", sg_event_id: "e" }]);
    expect(res.status).toBe(200);
  });
});
