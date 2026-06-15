import {
  extractTopicsForEvent,
  parseTopics,
  type EventForTopics,
} from "../src/jobs/ingestion/topicExtractionJob";
import type { HaikuClientDeps } from "../src/services/haikuCommentaryClient";
import type { db as realDb } from "../src/db";

describe("parseTopics", () => {
  it("parses a clean JSON array", () => {
    expect(parseTopics('["NVIDIA", "Export Controls", "HBM"]')).toEqual([
      "NVIDIA",
      "Export Controls",
      "HBM",
    ]);
  });

  it("dedupes case-insensitively, keeping first casing", () => {
    expect(parseTopics('["NVIDIA", "nvidia", "Nvidia"]')).toEqual(["NVIDIA"]);
  });

  it("caps at 5 topics", () => {
    expect(parseTopics('["a","b","c","d","e","f","g"]')).toHaveLength(5);
  });

  it("collapses whitespace and trims", () => {
    expect(parseTopics('["  Export   Controls  "]')).toEqual(["Export Controls"]);
  });

  it("drops empty strings and non-string items", () => {
    expect(parseTopics('["NVIDIA", "", 42, null, "HBM"]')).toEqual([
      "NVIDIA",
      "HBM",
    ]);
  });

  it("returns [] for non-JSON, non-array, or object output", () => {
    expect(parseTopics("not json")).toEqual([]);
    expect(parseTopics('"a string"')).toEqual([]);
    expect(parseTopics('{"topics":["x"]}')).toEqual([]);
  });
});

const EVENT: EventForTopics = {
  id: "evt-1",
  headline: "NVIDIA tightens HBM supply",
  context: "Memory allocation shifts as export controls bite.",
  sector: "semiconductors",
};

// A canned Haiku client: returns `continuation` as the model's text. The
// client prepends the "[" prefill, so pass the post-"[" remainder.
function cannedHaiku(continuation: string): HaikuClientDeps {
  return {
    client: {
      create: async () => ({ content: [{ type: "text", text: continuation }] }),
    },
  } as unknown as HaikuClientDeps;
}

function throwingHaiku(): HaikuClientDeps {
  return {
    client: {
      create: async () => {
        throw new Error("boom");
      },
    },
  } as unknown as HaikuClientDeps;
}

// Minimal db stub that records the values passed to .update().set().where().
function recordingDb(record: { called: boolean; topics?: string[] }): typeof realDb {
  return {
    update: () => ({
      set: (vals: { topics: string[] }) => ({
        where: async () => {
          record.called = true;
          record.topics = vals.topics;
        },
      }),
    }),
  } as unknown as typeof realDb;
}

describe("extractTopicsForEvent", () => {
  it("stores and returns parsed topics on success", async () => {
    const record = { called: false } as { called: boolean; topics?: string[] };
    const topics = await extractTopicsForEvent(EVENT, {
      db: recordingDb(record),
      haiku: cannedHaiku('"NVIDIA", "HBM"]'),
    });
    expect(topics).toEqual(["NVIDIA", "HBM"]);
    expect(record.called).toBe(true);
    expect(record.topics).toEqual(["NVIDIA", "HBM"]);
  });

  it("stamps an empty result so it is not retried", async () => {
    const record = { called: false } as { called: boolean; topics?: string[] };
    const topics = await extractTopicsForEvent(EVENT, {
      db: recordingDb(record),
      haiku: cannedHaiku("]"), // → "[]"
    });
    expect(topics).toEqual([]);
    // Still written (topics=[] + topics_extracted_at) so the row isn't requeued.
    expect(record.called).toBe(true);
    expect(record.topics).toEqual([]);
  });

  it("leaves the row untouched on a transient LLM failure", async () => {
    const record = { called: false } as { called: boolean; topics?: string[] };
    const topics = await extractTopicsForEvent(EVENT, {
      db: recordingDb(record),
      haiku: throwingHaiku(),
    });
    expect(topics).toEqual([]);
    // No write → topics_extracted_at stays NULL → retried next run.
    expect(record.called).toBe(false);
  });
});
