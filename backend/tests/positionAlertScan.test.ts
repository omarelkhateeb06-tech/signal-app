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

import {
  scanEventForPositionAlerts,
  eventGist,
} from "../src/jobs/ingestion/positionAlertScan";

const eventId = "33333333-3333-3333-3333-333333333333";
const beliefId = "11111111-1111-1111-1111-111111111111";
const challengeId = "22222222-2222-2222-2222-222222222222";

const eventRow = {
  id: eventId,
  headline: "Sub-quadratic models beat transformers at a tenth the compute",
  sector: "ai",
  genericCommentary: "A state-space architecture matches frontier quality cheaply.",
  whyItMatters: "Cheaper frontier quality.",
};
const positionRow = {
  id: beliefId,
  userId: "user-1",
  statement: "Transformer scaling keeps winning through 2027",
  sector: "ai",
  whatWouldBreakIt: "A cheaper non-transformer architecture matches frontier quality",
  email: "reader@example.com",
  name: "Reader",
};

function deps(over: any = {}): any {
  return {
    matchBelief: jest.fn(),
    notify: jest.fn().mockResolvedValue({ emailed: true }),
    captureFailure: jest.fn(),
    ...over,
  };
}

beforeEach(() => {
  mock.reset();
  process.env.ANTHROPIC_API_KEY = "test-key";
});

describe("eventGist", () => {
  it("prefers generic commentary, falls back to why-it-matters", () => {
    expect(eventGist("generic here", "why here")).toBe("generic here");
    expect(eventGist(null, "why here")).toBe("why here");
    expect(eventGist("   ", "why here")).toBe("why here");
    expect(eventGist(null, null)).toBe("");
  });
  it("trims to the gist cap on a word boundary", () => {
    const long = "word ".repeat(200).trim();
    const out = eventGist(long, null);
    expect(out.length).toBeLessThanOrEqual(360);
    expect(out.endsWith(" ")).toBe(false);
  });
});

describe("scanEventForPositionAlerts", () => {
  it("no-ops when ANTHROPIC_API_KEY is unset", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const d = deps();
    const res = await scanEventForPositionAlerts(eventId, d);
    expect(res).toEqual({ checked: 0, alerts: 0, emailed: 0 });
    expect(d.matchBelief).not.toHaveBeenCalled();
  });

  it("returns zero when the event is gone", async () => {
    mock.queueSelect([]); // event lookup
    const d = deps();
    const res = await scanEventForPositionAlerts(eventId, d);
    expect(res.alerts).toBe(0);
    expect(d.matchBelief).not.toHaveBeenCalled();
  });

  it("checks nothing when no positions match the sector", async () => {
    mock.queueSelect([eventRow]);
    mock.queueSelect([]); // no positions
    const d = deps();
    const res = await scanEventForPositionAlerts(eventId, d);
    expect(res).toEqual({ checked: 0, alerts: 0, emailed: 0 });
    expect(d.matchBelief).not.toHaveBeenCalled();
  });

  it("creates an alert and emails a material hit, feeding the falsifier", async () => {
    mock.queueSelect([eventRow]); // event
    mock.queueSelect([positionRow]); // active positions
    mock.queueInsert([{ id: challengeId }]); // challenge insert .returning()
    const d = deps({
      matchBelief: jest.fn().mockResolvedValue({
        eventIndex: 1,
        relevance: "contradicts",
        read: "Treat sub-quadratic architectures as a live threat.",
        dissent: "One result is not a paradigm.",
      }),
    });
    const res = await scanEventForPositionAlerts(eventId, d);
    expect(res).toEqual({ checked: 1, alerts: 1, emailed: 1 });
    expect(d.matchBelief).toHaveBeenCalledTimes(1);
    expect(d.matchBelief.mock.calls[0][0].belief.whatWouldBreakIt).toContain(
      "non-transformer",
    );
    expect(d.notify).toHaveBeenCalledTimes(1);
    expect(d.notify.mock.calls[0][0]).toMatchObject({
      challengeId,
      relevance: "contradicts",
      toEmail: "reader@example.com",
    });
    expect(mock.state.insertedValues[0]).toMatchObject({
      beliefId,
      eventId,
      relevance: "contradicts",
    });
  });

  it("records a radar (non-material) alert without emailing", async () => {
    mock.queueSelect([eventRow]);
    mock.queueSelect([positionRow]);
    mock.queueInsert([{ id: challengeId }]);
    const d = deps({
      matchBelief: jest.fn().mockResolvedValue({
        eventIndex: 1,
        relevance: "watch",
        read: "Adjacent; not moving the position yet.",
        dissent: "",
      }),
    });
    const res = await scanEventForPositionAlerts(eventId, d);
    expect(res).toEqual({ checked: 1, alerts: 1, emailed: 0 });
    expect(d.notify).not.toHaveBeenCalled();
  });

  it("does not notify when the alert already existed (dedup)", async () => {
    mock.queueSelect([eventRow]);
    mock.queueSelect([positionRow]);
    mock.queueInsert([]); // onConflictDoNothing → no row returned
    const d = deps({
      matchBelief: jest.fn().mockResolvedValue({
        eventIndex: 1,
        relevance: "contradicts",
        read: "x",
        dissent: "",
      }),
    });
    const res = await scanEventForPositionAlerts(eventId, d);
    expect(res).toEqual({ checked: 1, alerts: 0, emailed: 0 });
    expect(d.notify).not.toHaveBeenCalled();
  });

  it("creates no alert when the matcher returns no signal", async () => {
    mock.queueSelect([eventRow]);
    mock.queueSelect([positionRow]);
    const d = deps({ matchBelief: jest.fn().mockResolvedValue(null) });
    const res = await scanEventForPositionAlerts(eventId, d);
    expect(res).toEqual({ checked: 1, alerts: 0, emailed: 0 });
    expect(d.notify).not.toHaveBeenCalled();
  });
});
