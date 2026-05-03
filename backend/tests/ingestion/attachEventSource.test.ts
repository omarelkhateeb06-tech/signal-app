/* eslint-disable @typescript-eslint/no-explicit-any */
import { createMockDb, type MockDb } from "../helpers/mockDb";
import { attachEventSource } from "../../src/jobs/ingestion/attachEventSource";

const CANDIDATE_ID = "00000000-0000-0000-0000-0000000000aa";
const EVENT_ID = "11111111-1111-1111-1111-111111111111";

let mock: MockDb;

beforeEach(() => {
  mock = createMockDb();
});

// Two queueSelect calls per attach: candidate-for-attach, then current-primary.
function queueAttachReads(
  candidate: {
    ingestionSourceId: string | null;
    sourcePriority: number | null;
    sourceDisplayName?: string | null;
  },
  currentPrimary:
    | { id: string; ingestionSourceId: string | null; priority: number | null }
    | null,
): void {
  mock.queueSelect([
    {
      ingestionSourceId: candidate.ingestionSourceId,
      url: "https://example.test/article",
      rawTitle: "Title",
      bodyText: "body of the article",
      sourcePriority: candidate.sourcePriority,
      sourceDisplayName: candidate.sourceDisplayName ?? "Test Source",
    },
  ]);
  mock.queueSelect(currentPrimary ? [currentPrimary] : []);
}

describe("attachEventSource", () => {
  it("equal priority → role='alternate', promoted=false, candidate published", async () => {
    queueAttachReads(
      { ingestionSourceId: "src-incoming", sourcePriority: 3 },
      { id: "es-existing", ingestionSourceId: "src-existing", priority: 3 },
    );
    const result = await attachEventSource(
      { candidateId: CANDIDATE_ID, matchedEventId: EVENT_ID, similarity: 0.9 },
      { db: mock.db },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.promoted).toBe(false);
    // One INSERT (alternate row), no UPDATE on existing primary, one UPDATE
    // on candidate row.
    const inserted = mock.state.insertedValues[0];
    expect(inserted).toMatchObject({
      eventId: EVENT_ID,
      ingestionSourceId: "src-incoming",
      role: "alternate",
    });
    const candidatePatch = mock.state.updatedRows.find(
      (r: any) => r.status === "published",
    );
    expect(candidatePatch).toMatchObject({
      status: "published",
      resolvedEventId: EVENT_ID,
    });
  });

  it("lower priority value (higher rank) → existing primary demoted, new row inserted as primary, promoted=true", async () => {
    queueAttachReads(
      { ingestionSourceId: "src-incoming", sourcePriority: 1 },
      { id: "es-existing", ingestionSourceId: "src-existing", priority: 3 },
    );
    const result = await attachEventSource(
      { candidateId: CANDIDATE_ID, matchedEventId: EVENT_ID, similarity: 0.91 },
      { db: mock.db },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.promoted).toBe(true);
    // First UPDATE demotes existing primary to alternate.
    const demote = mock.state.updatedRows[0];
    expect(demote).toMatchObject({ role: "alternate" });
    // INSERT then advances candidate.
    const inserted = mock.state.insertedValues[0];
    expect(inserted).toMatchObject({ role: "primary" });
  });

  it("higher priority value (lower rank) incoming → role='alternate', promoted=false", async () => {
    queueAttachReads(
      { ingestionSourceId: "src-incoming", sourcePriority: 4 },
      { id: "es-existing", ingestionSourceId: "src-existing", priority: 2 },
    );
    const result = await attachEventSource(
      { candidateId: CANDIDATE_ID, matchedEventId: EVENT_ID, similarity: 0.88 },
      { db: mock.db },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.promoted).toBe(false);
    expect(mock.state.insertedValues[0]).toMatchObject({ role: "alternate" });
  });

  it("null candidate ingestionSourceId → returns attach_source_missing without writes", async () => {
    queueAttachReads(
      { ingestionSourceId: null, sourcePriority: null },
      { id: "es-existing", ingestionSourceId: "src-existing", priority: 3 },
    );
    const result = await attachEventSource(
      { candidateId: CANDIDATE_ID, matchedEventId: EVENT_ID, similarity: 0.9 },
      { db: mock.db },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejectionReason).toBe("attach_source_missing");
    expect(mock.state.insertedValues).toHaveLength(0);
    expect(mock.state.updatedRows).toHaveLength(0);
  });

  it("DB transaction throws → returns attach_db_error wrapping the error", async () => {
    queueAttachReads(
      { ingestionSourceId: "src-incoming", sourcePriority: 3 },
      { id: "es-existing", ingestionSourceId: "src-existing", priority: 3 },
    );
    const txError = new Error("simulated unique-violation");
    mock.db.transaction = jest.fn().mockRejectedValue(txError);
    const result = await attachEventSource(
      { candidateId: CANDIDATE_ID, matchedEventId: EVENT_ID, similarity: 0.9 },
      { db: mock.db },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejectionReason).toBe("attach_db_error");
      expect(result.error).toBe(txError);
    }
  });

  it("current primary missing FK / null priority → keeps existing primary, attaches as alternate", async () => {
    // Defensive: deleted ingestion_sources row leaves event_sources.ingestion_source_id
    // null via ON DELETE SET NULL. Without a comparable priority, promotion can't
    // run safely — first-mover wins.
    queueAttachReads(
      { ingestionSourceId: "src-incoming", sourcePriority: 1 },
      { id: "es-existing", ingestionSourceId: null, priority: null },
    );
    const result = await attachEventSource(
      { candidateId: CANDIDATE_ID, matchedEventId: EVENT_ID, similarity: 0.9 },
      { db: mock.db },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.promoted).toBe(false);
    expect(mock.state.insertedValues[0]).toMatchObject({ role: "alternate" });
  });

  it("no current primary at all (matched event has none) → attaches as alternate, no promotion", async () => {
    queueAttachReads(
      { ingestionSourceId: "src-incoming", sourcePriority: 1 },
      null,
    );
    const result = await attachEventSource(
      { candidateId: CANDIDATE_ID, matchedEventId: EVENT_ID, similarity: 0.9 },
      { db: mock.db },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.promoted).toBe(false);
    expect(mock.state.insertedValues[0]).toMatchObject({ role: "alternate" });
  });

  describe("12e.6c re-enrichment trigger", () => {
    let warnSpy: jest.SpyInstance;
    let logSpy: jest.SpyInstance;

    beforeEach(() => {
      warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
      logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
    });

    afterEach(() => {
      warnSpy.mockRestore();
      logSpy.mockRestore();
    });

    it("successful attach calls reenrichEvent with eventId + candidateId", async () => {
      queueAttachReads(
        { ingestionSourceId: "src-incoming", sourcePriority: 3 },
        { id: "es-existing", ingestionSourceId: "src-existing", priority: 3 },
      );
      const reenrichMock = jest
        .fn()
        .mockResolvedValue({ ok: true, skipped: false });
      const result = await attachEventSource(
        { candidateId: CANDIDATE_ID, matchedEventId: EVENT_ID, similarity: 0.9 },
        { db: mock.db, reenrichEvent: reenrichMock },
      );
      expect(result.ok).toBe(true);
      expect(reenrichMock).toHaveBeenCalledTimes(1);
      expect(reenrichMock).toHaveBeenCalledWith(
        { eventId: EVENT_ID, candidateId: CANDIDATE_ID },
        expect.objectContaining({ db: mock.db }),
      );
    });

    it("rate-limited re-enrichment → attach still ok, no warn", async () => {
      queueAttachReads(
        { ingestionSourceId: "src-incoming", sourcePriority: 3 },
        { id: "es-existing", ingestionSourceId: "src-existing", priority: 3 },
      );
      const reenrichMock = jest
        .fn()
        .mockResolvedValue({ ok: true, skipped: true });
      const result = await attachEventSource(
        { candidateId: CANDIDATE_ID, matchedEventId: EVENT_ID, similarity: 0.9 },
        { db: mock.db, reenrichEvent: reenrichMock },
      );
      expect(result.ok).toBe(true);
      expect(reenrichMock).toHaveBeenCalledTimes(1);
      // Skipped is steady-state — no warn emitted.
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("re-enrichment soft-fail → attach still ok, console.warn emitted", async () => {
      queueAttachReads(
        { ingestionSourceId: "src-incoming", sourcePriority: 3 },
        { id: "es-existing", ingestionSourceId: "src-existing", priority: 3 },
      );
      const reenrichMock = jest.fn().mockResolvedValue({
        ok: false,
        rejectionReason: "reenrich_facts_failed",
      });
      const result = await attachEventSource(
        { candidateId: CANDIDATE_ID, matchedEventId: EVENT_ID, similarity: 0.9 },
        { db: mock.db, reenrichEvent: reenrichMock },
      );
      expect(result.ok).toBe(true);
      expect(reenrichMock).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalled();
      expect(warnSpy.mock.calls[0][0]).toContain(
        "re-enrichment soft-failed",
      );
    });
  });
});
