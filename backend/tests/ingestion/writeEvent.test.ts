/* eslint-disable @typescript-eslint/no-explicit-any */
import { createMockDb, type MockDb } from "../helpers/mockDb";
import {
  writeEvent,
  computeWhyItMatters,
  computeContext,
  computeWhyItMattersTemplate,
  type CandidateRowForWrite,
} from "../../src/jobs/ingestion/writeEvent";

const CANDIDATE_ID = "00000000-0000-0000-0000-0000000000cc";
const EVENT_ID = "11111111-1111-1111-1111-111111111111";
const SOURCE_ID = "22222222-2222-2222-2222-222222222222";
const WRITER_ID = "33333333-3333-3333-3333-333333333333";

let mock: MockDb;

beforeEach(() => {
  mock = createMockDb();
});

function fullCandidate(
  overrides: Partial<CandidateRowForWrite> = {},
): CandidateRowForWrite {
  return {
    id: CANDIDATE_ID,
    ingestionSourceId: SOURCE_ID,
    url: "https://example.com/story-123",
    rawTitle: "TSMC pulls in 2nm production by Q3 2026",
    rawSummary: "TSMC announced an earlier 2nm timeline.",
    rawPublishedAt: new Date("2026-04-28T10:00:00Z"),
    bodyText: "Full article body for the test.",
    sector: "semiconductors",
    facts: { facts: [{ text: "TSMC moved 2nm to Q3 2026.", category: "action" }] },
    tierOutputs: {
      accessible: {
        thesis: "Accessible thesis text passing TierOutputSchema bounds.",
        support: "Accessible support text passing TierOutputSchema bounds.",
      },
      briefed: {
        thesis: "Briefed thesis text passing TierOutputSchema bounds.",
        support: "Briefed support text passing TierOutputSchema bounds.",
      },
      technical: {
        thesis: "Technical thesis text passing TierOutputSchema bounds.",
        support: "Technical support text passing TierOutputSchema bounds.",
      },
    },
    sourceDisplayName: "Example Source",
    sourcePairedWriterId: WRITER_ID,
    ...overrides,
  };
}

describe("computeWhyItMatters fallback chain", () => {
  it("level 1: prefers briefed.thesis when present", () => {
    const result = computeWhyItMatters(fullCandidate());
    expect(result).toBe("Briefed thesis text passing TierOutputSchema bounds.");
  });

  it("level 2: falls back to accessible.thesis when briefed missing", () => {
    const result = computeWhyItMatters(
      fullCandidate({
        tierOutputs: {
          accessible: { thesis: "A", support: "AS" },
          technical: { thesis: "T", support: "TS" },
          // briefed omitted
        },
      }),
    );
    expect(result).toBe("A");
  });

  it("level 2: falls back to accessible.thesis when briefed.thesis is empty string", () => {
    const result = computeWhyItMatters(
      fullCandidate({
        tierOutputs: {
          accessible: { thesis: "A2", support: "AS" },
          briefed: { thesis: "", support: "BS" },
          technical: { thesis: "T", support: "TS" },
        },
      }),
    );
    expect(result).toBe("A2");
  });

  it("level 3: falls back to technical.thesis when briefed + accessible missing", () => {
    const result = computeWhyItMatters(
      fullCandidate({
        tierOutputs: {
          technical: { thesis: "Tech-only thesis", support: "TS" },
        },
      }),
    );
    expect(result).toBe("Tech-only thesis");
  });

  it("level 4 (floor): synthesizes from headline + first fact when no tier theses present", () => {
    const result = computeWhyItMatters(
      fullCandidate({
        tierOutputs: null,
        rawTitle: "Headline",
        facts: { facts: [{ text: "First fact text.", category: "action" }] },
      }),
    );
    expect(result).toBe("Headline: First fact text.");
  });

  it("level 4 (floor): falls back to headline alone when facts is also empty", () => {
    const result = computeWhyItMatters(
      fullCandidate({
        tierOutputs: null,
        rawTitle: "Headline only",
        facts: null,
      }),
    );
    expect(result).toBe("Headline only");
  });

  it("level 4 (floor): defensive 'Untitled' when both headline and facts absent", () => {
    const result = computeWhyItMatters(
      fullCandidate({
        tierOutputs: null,
        rawTitle: null,
        facts: null,
      }),
    );
    expect(result).toBe("Untitled");
  });

  it("falls through empty briefed.thesis to next tier (treats whitespace-empty consistently)", () => {
    const result = computeWhyItMatters(
      fullCandidate({
        tierOutputs: {
          accessible: { thesis: "", support: "" },
          briefed: { thesis: "", support: "" },
          technical: { thesis: "Tech wins", support: "TS" },
        },
      }),
    );
    expect(result).toBe("Tech wins");
  });
});

describe("computeContext", () => {
  it("uses raw_summary verbatim when non-empty", () => {
    const result = computeContext(fullCandidate({ rawSummary: "Short summary." }));
    expect(result).toBe("Short summary.");
  });

  it("falls back to body_text when summary is empty/whitespace", () => {
    const result = computeContext(
      fullCandidate({ rawSummary: "   ", bodyText: "Body content here." }),
    );
    expect(result).toBe("Body content here.");
  });

  it("truncates body_text to ≤500 chars at last whitespace boundary", () => {
    const longBody = "word ".repeat(200); // ~1000 chars
    const result = computeContext(
      fullCandidate({ rawSummary: null, bodyText: longBody }),
    );
    expect(result.length).toBeLessThanOrEqual(500);
    // Truncation lands on a word boundary (no trailing partial word).
    expect(result.endsWith(" ")).toBe(false);
    expect(result.endsWith("word")).toBe(true);
  });

  it("does not truncate at very-early space (uses hard cut if no late-half boundary)", () => {
    // Construct a body where the only space is in the first 50 chars,
    // then a long single token. Truncation should hard-cut at 500
    // rather than producing a tiny prefix.
    const body = "early " + "a".repeat(800);
    const result = computeContext(
      fullCandidate({ rawSummary: null, bodyText: body }),
    );
    expect(result.length).toBe(500);
  });

  it("falls back to headline when both summary and body are empty", () => {
    const result = computeContext(
      fullCandidate({ rawSummary: null, bodyText: null, rawTitle: "Title" }),
    );
    expect(result).toBe("Title");
  });

  it("respects body_text shorter than the cap (no truncation)", () => {
    const body = "Short body.";
    const result = computeContext(
      fullCandidate({ rawSummary: null, bodyText: body }),
    );
    expect(result).toBe(body);
  });
});

describe("computeWhyItMattersTemplate", () => {
  it("validates and stringifies a well-formed tier_outputs blob", () => {
    const result = computeWhyItMattersTemplate(fullCandidate());
    expect(result).not.toBeNull();
    const parsed = JSON.parse(result as string);
    expect(parsed.briefed.thesis).toBe(
      "Briefed thesis text passing TierOutputSchema bounds.",
    );
    expect(parsed.accessible.thesis).toBe(
      "Accessible thesis text passing TierOutputSchema bounds.",
    );
    expect(parsed.technical.thesis).toBe(
      "Technical thesis text passing TierOutputSchema bounds.",
    );
  });

  it("throws on validation failure (missing tier key)", () => {
    // Strict-at-write per locked sub-step-3 spec correction: missing
    // required key throws ZodError instead of silently returning null.
    expect(() =>
      computeWhyItMattersTemplate(
        fullCandidate({
          tierOutputs: {
            accessible: { thesis: "A", support: "AS" },
            briefed: { thesis: "B", support: "BS" },
            // technical omitted — schema strict requires it
          },
        }),
      ),
    ).toThrow();
  });

  it("throws when tier_outputs is null (no silent skip)", () => {
    // Strict-at-write: a null tier_outputs at writeEvent time means
    // upstream tier orchestration fired markTierGeneratedComplete
    // without populating the JSONB column — a real bug worth surfacing
    // loudly. assertTierTemplate(null) throws ZodError.
    expect(() =>
      computeWhyItMattersTemplate(fullCandidate({ tierOutputs: null })),
    ).toThrow();
  });

  it("throws on shape mismatch (legacy 12a per-tier-string shape)", () => {
    // Legacy {accessible: string, briefed: string, technical: string}
    // shape is rejected by TierTemplateSchema (which requires the new
    // per-tier {thesis, support} shape). Strict-at-write throws.
    expect(() =>
      computeWhyItMattersTemplate(
        fullCandidate({
          tierOutputs: {
            accessible: "string instead of object",
            briefed: "string",
            technical: "string",
          } as unknown as Record<string, unknown>,
        }),
      ),
    ).toThrow();
  });
});

describe("writeEvent integration", () => {
  function queueLoadCandidate(row: Partial<CandidateRowForWrite>): void {
    mock.queueSelect([{ ...fullCandidate(), ...row }]);
  }

  it("happy path: inserts events row + event_sources row + updates candidate to published", async () => {
    queueLoadCandidate({});
    mock.queueInsert([{ id: EVENT_ID }]); // events insert returning
    // event_sources insert returning result not pulled (no .returning() call).
    const fakeNow = new Date("2026-04-28T12:00:00Z");
    const result = await writeEvent(CANDIDATE_ID, {
      db: mock.db,
      now: () => fakeNow,
    });
    expect(result).toEqual({ eventId: EVENT_ID });

    // Two inserts captured (events, event_sources).
    expect(mock.state.insertedValues.length).toBe(2);
    const eventInsert = mock.state.insertedValues[0];
    expect(eventInsert.sector).toBe("semiconductors");
    expect(eventInsert.headline).toBe("TSMC pulls in 2nm production by Q3 2026");
    expect(eventInsert.context).toBe("TSMC announced an earlier 2nm timeline.");
    expect(eventInsert.whyItMatters).toBe(
      "Briefed thesis text passing TierOutputSchema bounds.",
    );
    expect(typeof eventInsert.whyItMattersTemplate).toBe("string");
    expect(JSON.parse(eventInsert.whyItMattersTemplate).briefed.thesis).toBe(
      "Briefed thesis text passing TierOutputSchema bounds.",
    );
    expect(eventInsert.primarySourceUrl).toBe("https://example.com/story-123");
    expect(eventInsert.primarySourceName).toBe("Example Source");
    expect(eventInsert.authorId).toBe(WRITER_ID);
    expect(eventInsert.facts).toEqual({
      facts: [{ text: "TSMC moved 2nm to Q3 2026.", category: "action" }],
    });
    expect(eventInsert.publishedAt).toEqual(new Date("2026-04-28T10:00:00Z"));

    const eventSourceInsert = mock.state.insertedValues[1];
    expect(eventSourceInsert.eventId).toBe(EVENT_ID);
    expect(eventSourceInsert.ingestionSourceId).toBe(SOURCE_ID);
    expect(eventSourceInsert.url).toBe("https://example.com/story-123");
    expect(eventSourceInsert.name).toBe("Example Source");
    expect(eventSourceInsert.role).toBe("primary");

    // Candidate updated to published with resolved_event_id + processed_at.
    expect(mock.state.updatedRows.length).toBe(1);
    const candidateUpdate = mock.state.updatedRows[0];
    expect(candidateUpdate.status).toBe("published");
    expect(candidateUpdate.resolvedEventId).toBe(EVENT_ID);
    expect(candidateUpdate.processedAt).toEqual(fakeNow);
    expect(candidateUpdate.statusReason).toBeNull();
  });

  it("passes raw_published_at through to events.published_at (no synthesis)", async () => {
    const articleTime = new Date("2026-04-15T08:30:00Z");
    queueLoadCandidate({ rawPublishedAt: articleTime });
    mock.queueInsert([{ id: EVENT_ID }]);
    await writeEvent(CANDIDATE_ID, { db: mock.db });
    expect(mock.state.insertedValues[0].publishedAt).toEqual(articleTime);
  });

  it("leaves events.published_at null when raw_published_at is null", async () => {
    queueLoadCandidate({ rawPublishedAt: null });
    mock.queueInsert([{ id: EVENT_ID }]);
    await writeEvent(CANDIDATE_ID, { db: mock.db });
    expect(mock.state.insertedValues[0].publishedAt).toBeNull();
  });

  it("truncates headline at 255 chars", async () => {
    const longTitle = "A".repeat(400);
    queueLoadCandidate({ rawTitle: longTitle });
    mock.queueInsert([{ id: EVENT_ID }]);
    await writeEvent(CANDIDATE_ID, { db: mock.db });
    expect(mock.state.insertedValues[0].headline.length).toBe(255);
  });

  it("throws (does NOT write null) when tier_outputs fails assertTierTemplate", async () => {
    // Strict-at-write per locked sub-step-3 correction: tier_outputs
    // missing a required key causes computeWhyItMattersTemplate to
    // throw ZodError BEFORE the db.transaction starts, so no events
    // row is inserted. processEnrichmentJob's wiring catches the throw
    // and surfaces as terminalStatus='failed' with 'write_event_error:'
    // prefix (covered separately in enrichmentJob.test.ts).
    queueLoadCandidate({
      tierOutputs: {
        accessible: { thesis: "A", support: "AS" },
        briefed: { thesis: "B", support: "BS" },
        // technical omitted
      },
    });
    await expect(
      writeEvent(CANDIDATE_ID, { db: mock.db }),
    ).rejects.toThrow();
    // No events insert was attempted (throw fires before db.transaction).
    expect(mock.state.insertedValues.length).toBe(0);
    expect(mock.state.updatedRows.length).toBe(0);
  });

  it("throws when candidate row not found", async () => {
    // Empty select result.
    mock.queueSelect([]);
    await expect(writeEvent(CANDIDATE_ID, { db: mock.db })).rejects.toThrow(
      /candidate .* not found/,
    );
  });

  it("throws when sector is null (relevance gate didn't classify)", async () => {
    queueLoadCandidate({ sector: null });
    await expect(writeEvent(CANDIDATE_ID, { db: mock.db })).rejects.toThrow(
      /null sector/,
    );
  });

  it("transaction rollback: event_sources insert failure propagates and skips candidate update", async () => {
    queueLoadCandidate({});
    mock.queueInsert([{ id: EVENT_ID }]); // events insert succeeds

    // Replace mock.db.insert to throw on the second call (event_sources).
    let insertCalls = 0;
    const originalInsert = mock.db.insert;
    mock.db.insert = (table: any) => {
      insertCalls += 1;
      if (insertCalls === 2) {
        // Simulate a constraint violation / connection error mid-transaction.
        throw new Error("simulated event_sources insert failure");
      }
      return originalInsert(table);
    };

    await expect(writeEvent(CANDIDATE_ID, { db: mock.db })).rejects.toThrow(
      /simulated event_sources insert failure/,
    );

    // events insert was attempted (1 captured), event_sources insert
    // threw before .values() was reached so insertedValues[1] is absent.
    expect(mock.state.insertedValues.length).toBe(1);
    // Critically: candidate update did NOT run — caught by the throw
    // propagating out of the transaction callback.
    expect(mock.state.updatedRows.length).toBe(0);
  });
});
