/* eslint-disable @typescript-eslint/no-explicit-any */
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

// Capture enqueue calls at the queue boundary so no real Redis/SendGrid runs.
const enqueueEmailMock = jest
  .fn()
  .mockResolvedValue({ queued: true, jobId: "job-1" });
jest.mock("../src/jobs/emailQueue", () => ({
  __esModule: true,
  enqueueEmail: (...args: unknown[]) => enqueueEmailMock(...args),
}));

import { notifyBeliefAlert } from "../src/services/beliefAlertService";
import { renderBeliefAlertEmail } from "../src/emails/beliefAlertEmail";

const challengeId = "22222222-2222-2222-2222-222222222222";
const userId = "user-1";

const baseInput = {
  challengeId,
  userId,
  toEmail: "reader@example.com",
  toName: "Reader",
  positionStatement: "Transformer scaling keeps winning through 2027",
  relevance: "contradicts",
  howToUpdate: "Treat sub-quadratic architectures as a live threat.",
  dissent: "One benchmark is not a paradigm.",
  sourceHeadline: "Sub-quadratic model beats GPT-4 at a tenth the compute",
};

beforeAll(() => {
  process.env.UNSUBSCRIBE_SECRET = "test-unsubscribe-secret-please";
});

describe("renderBeliefAlertEmail", () => {
  it("renders the position, the read, the counter-case, and a /beliefs CTA", () => {
    const out = renderBeliefAlertEmail({
      toName: "Reader",
      positionStatement: "Transformer scaling keeps winning",
      relevance: "contradicts",
      howToUpdate: "Treat sub-quadratic as a live threat.",
      dissent: "One benchmark is not a paradigm.",
      sourceHeadline: "A sub-quadratic model beats GPT-4",
      frontendUrl: "https://app.example.com",
    });
    expect(out.subject.toLowerCase()).toContain("contradicts");
    expect(out.html).toContain("Transformer scaling keeps winning");
    expect(out.html).toContain("Treat sub-quadratic as a live threat.");
    expect(out.html).toContain("One benchmark is not a paradigm.");
    expect(out.html).toContain("https://app.example.com/beliefs");
    expect(out.text).toContain("Transformer scaling keeps winning");
  });

  it("escapes HTML in the position statement", () => {
    const out = renderBeliefAlertEmail({
      toName: null,
      positionStatement: "<script>alert(1)</script> still wins",
      relevance: "pressures",
      howToUpdate: "Watch it.",
      dissent: null,
      sourceHeadline: null,
      frontendUrl: "https://app.example.com",
    });
    expect(out.html).not.toContain("<script>alert(1)</script>");
    expect(out.html).toContain("&lt;script&gt;");
  });
});

describe("notifyBeliefAlert", () => {
  beforeEach(() => {
    mock.reset();
    enqueueEmailMock.mockClear();
  });

  it("emails a material alert once and stamps notified_at", async () => {
    mock.queueInsert([{ id: challengeId }]); // the guarded claim wins
    const res = await notifyBeliefAlert({ ...baseInput });
    expect(res.emailed).toBe(true);
    expect(enqueueEmailMock).toHaveBeenCalledTimes(1);
    const arg = enqueueEmailMock.mock.calls[0][0] as any;
    expect(arg.type).toBe("belief-alert");
    expect(arg.payload.to).toBe("reader@example.com");
    expect(arg.payload.subject.toLowerCase()).toContain("contradicts");
    // The claim stamped notified_at.
    expect(
      mock.state.updatedRows.some((r) => r.notifiedAt instanceof Date),
    ).toBe(true);
  });

  it("skips a non-material alert (supports/watch) — no claim, no email", async () => {
    const res = await notifyBeliefAlert({ ...baseInput, relevance: "supports" });
    expect(res.emailed).toBe(false);
    expect(enqueueEmailMock).not.toHaveBeenCalled();
    expect(mock.state.updatedRows.length).toBe(0);
  });

  it("does not re-send when the alert was already notified (claim returns no row)", async () => {
    mock.queueInsert([]); // guarded UPDATE … RETURNING matched nothing
    const res = await notifyBeliefAlert({ ...baseInput });
    expect(res.emailed).toBe(false);
    expect(enqueueEmailMock).not.toHaveBeenCalled();
  });
});
