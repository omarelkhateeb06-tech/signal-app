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

const enqueueEmailMock = jest.fn().mockResolvedValue({ queued: true, jobId: "job-1" });
jest.mock("../src/jobs/emailQueue", () => ({
  __esModule: true,
  enqueueEmail: (...args: unknown[]) => enqueueEmailMock(...args),
  getEmailQueue: () => null,
  closeEmailQueue: async () => undefined,
  EMAIL_QUEUE_NAME: "signal-emails",
}));

import { createApp } from "../src/app";

const app = createApp();

describe("signup queues a welcome email", () => {
  beforeEach(() => {
    mock.reset();
    enqueueEmailMock.mockClear();
  });

  it("enqueues a welcome email on successful signup", async () => {
    mock.queueSelect([]); // existence check
    mock.queueInsert([{ id: "user-1", email: "a@b.com", name: "Ada" }]);
    mock.queueInsert([]); // user_profiles insert

    const res = await request(app)
      .post("/api/v1/auth/signup")
      .send({ email: "a@b.com", password: "password123", name: "Ada" });

    expect(res.status).toBe(201);
    // The enqueue is fire-and-forget (`void`) — wait a tick for it to run.
    await new Promise((r) => setImmediate(r));
    expect(enqueueEmailMock).toHaveBeenCalledTimes(1);
    const jobArg = enqueueEmailMock.mock.calls[0][0];
    expect(jobArg.type).toBe("welcome");
    expect(jobArg.payload.to).toBe("a@b.com");
    expect(jobArg.payload.subject).toContain("Welcome");
    expect(jobArg.payload.html).toContain("Ada");
    expect(jobArg.payload.html).toContain("/unsubscribe?token=");
  });

  it("does not block signup if enqueue fails", async () => {
    mock.queueSelect([]);
    mock.queueInsert([{ id: "user-2", email: "fail@b.com", name: "Test" }]);
    mock.queueInsert([]);
    enqueueEmailMock.mockRejectedValueOnce(new Error("redis down"));

    const res = await request(app)
      .post("/api/v1/auth/signup")
      .send({ email: "fail@b.com", password: "password123", name: "Test" });

    expect(res.status).toBe(201);
    expect(res.body.data.user.id).toBe("user-2");
  });

  it("does not enqueue when signup fails validation", async () => {
    const res = await request(app)
      .post("/api/v1/auth/signup")
      .send({ email: "not-an-email", password: "password123", name: "Ada" });
    expect(res.status).toBe(400);
    await new Promise((r) => setImmediate(r));
    expect(enqueueEmailMock).not.toHaveBeenCalled();
  });
});
