import { createMockDb } from "./helpers/mockDb";

const mock = createMockDb();

jest.mock("../src/db", () => ({
  __esModule: true,
  get db() {
    return mock.db;
  },
  pool: { end: async (): Promise<void> => undefined },
}));

import {
  SeedValidationError,
  buildPlaceholderMap,
  insertStoryBatch,
  partitionStoriesByExistence,
  upsertWriter,
  validateSeedFile,
  type SeedFile,
  type StorySeed,
  type WriterSeed,
} from "../src/scripts/seedStories";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { db } = require("../src/db") as { db: any };

// ---------- Fixtures ----------

function validWriter(overrides: Partial<WriterSeed> = {}): WriterSeed {
  return {
    placeholder_id: "SIGNAL_EDITORIAL",
    name: "SIGNAL Editorial",
    slug: "signal-editorial",
    bio: "SIGNAL's editorial desk.",
    ...overrides,
  };
}

function validStory(overrides: Partial<StorySeed> = {}): StorySeed {
  return {
    sector: "ai",
    headline: "OpenAI closes record $122B round",
    context: "Context paragraph with real framing.",
    why_it_matters: "Role-neutral fallback commentary.",
    // Phase 12a depth-variant shape — the seeder's strict Zod rejects the
    // pre-12a sector keys (ai/finance/semiconductors) outright.
    why_it_matters_template: {
      accessible: "Accessible-depth commentary.",
      briefed: "Briefed-depth commentary.",
      technical: "Technical-depth commentary.",
    },
    source_url: "https://example.com/article/openai-round",
    source_name: "Example News",
    author_id: "SIGNAL_EDITORIAL",
    published_at: "2026-03-31T12:00:00Z",
    ...overrides,
  };
}

function validFile(overrides: Partial<SeedFile> = {}): SeedFile {
  return {
    writers_seed: [validWriter()],
    stories: [validStory()],
    ...overrides,
  };
}

// ---------- validateSeedFile ----------

describe("validateSeedFile", () => {
  it("accepts a well-formed file", () => {
    const data = validateSeedFile(validFile());
    expect(data.stories).toHaveLength(1);
    expect(data.writers_seed[0]?.placeholder_id).toBe("SIGNAL_EDITORIAL");
  });

  it("rejects an invalid sector with a per-item error that names the story", () => {
    const bad = validFile({
      stories: [validStory({ sector: "crypto" as unknown as StorySeed["sector"] })],
    });
    let err: SeedValidationError | null = null;
    try {
      validateSeedFile(bad);
    } catch (e) {
      if (e instanceof SeedValidationError) err = e;
    }
    expect(err).not.toBeNull();
    expect(err?.issues.length).toBeGreaterThan(0);
    const joined = err?.issues.join("\n") ?? "";
    expect(joined).toMatch(/stories\.0\.sector/);
    expect(joined).toMatch(/story 1/);
    expect(joined).toMatch(/OpenAI closes record/);
  });

  it("rejects a malformed source_url", () => {
    const bad = validFile({
      stories: [validStory({ source_url: "not-a-real-url" })],
    });
    expect(() => validateSeedFile(bad)).toThrow(SeedValidationError);
    try {
      validateSeedFile(bad);
    } catch (e) {
      if (e instanceof SeedValidationError) {
        expect(e.issues.some((i) => i.includes("source_url"))).toBe(true);
      }
    }
  });

  it("rejects a non-ISO published_at", () => {
    const bad = validFile({
      stories: [validStory({ published_at: "yesterday" })],
    });
    try {
      validateSeedFile(bad);
      fail("expected SeedValidationError");
    } catch (e) {
      expect(e).toBeInstanceOf(SeedValidationError);
      if (e instanceof SeedValidationError) {
        expect(e.issues.some((i) => i.includes("published_at"))).toBe(true);
      }
    }
  });

  it("rejects an author_id placeholder that is not in writers_seed", () => {
    const bad = validFile({
      stories: [validStory({ author_id: "UNKNOWN_DESK" })],
    });
    try {
      validateSeedFile(bad);
      fail("expected SeedValidationError");
    } catch (e) {
      expect(e).toBeInstanceOf(SeedValidationError);
      if (e instanceof SeedValidationError) {
        const joined = e.issues.join("\n");
        expect(joined).toMatch(/UNKNOWN_DESK/);
        expect(joined).toMatch(/not found in writers_seed/);
        expect(joined).toMatch(/headline:/);
      }
    }
  });
});

// ---------- upsertWriter ----------

describe("upsertWriter", () => {
  beforeEach(() => {
    mock.reset();
  });

  it("inserts a new writer row when SELECT returns nothing", async () => {
    mock.queueSelect([]);
    mock.queueInsert([{ id: "new-writer-uuid" }]);

    const result = await upsertWriter(db, validWriter());
    expect(result).toEqual({ id: "new-writer-uuid", created: true });
  });

  it("returns existing id without inserting when SELECT returns a match", async () => {
    mock.queueSelect([{ id: "existing-writer-uuid" }]);

    const result = await upsertWriter(db, validWriter());
    expect(result).toEqual({ id: "existing-writer-uuid", created: false });
    // No insert was consumed.
    expect(mock.state.insertResults.length).toBe(0);
  });
});

// ---------- buildPlaceholderMap ----------

describe("buildPlaceholderMap", () => {
  beforeEach(() => {
    mock.reset();
  });

  it("maps SIGNAL_EDITORIAL to the resolved writer uuid", async () => {
    mock.queueSelect([{ id: "resolved-uuid" }]);
    const { map, created, matched } = await buildPlaceholderMap(db, [validWriter()]);
    expect(map.get("SIGNAL_EDITORIAL")).toBe("resolved-uuid");
    expect(created).toBe(0);
    expect(matched).toBe(1);
  });
});

// ---------- partitionStoriesByExistence ----------

describe("partitionStoriesByExistence (idempotency)", () => {
  beforeEach(() => {
    mock.reset();
  });

  it("second run with identical input inserts zero and skips all", async () => {
    const s1 = validStory({ source_url: "https://example.com/a" });
    const s2 = validStory({ source_url: "https://example.com/b" });
    // Simulate both URLs already present in the DB.
    mock.queueSelect([{ sourceUrl: s1.source_url }, { sourceUrl: s2.source_url }]);

    const { toInsert, toSkip } = await partitionStoriesByExistence(db, [s1, s2]);
    expect(toInsert).toHaveLength(0);
    expect(toSkip).toHaveLength(2);
  });

  it("partitions mixed inputs correctly", async () => {
    const existing = validStory({ source_url: "https://example.com/exists" });
    const fresh = validStory({ source_url: "https://example.com/fresh" });
    mock.queueSelect([{ sourceUrl: existing.source_url }]);

    const { toInsert, toSkip } = await partitionStoriesByExistence(db, [existing, fresh]);
    expect(toInsert).toEqual([fresh]);
    expect(toSkip).toEqual([existing]);
  });
});

// ---------- insertStoryBatch ----------

describe("insertStoryBatch", () => {
  beforeEach(() => {
    mock.reset();
  });

  it("resolves SIGNAL_EDITORIAL placeholder to the real uuid at insert time", async () => {
    const story = validStory();
    const authorMap = new Map<string, string>([["SIGNAL_EDITORIAL", "author-uuid-123"]]);
    // No returning() is called inside insertStoryBatch, so no queued rows needed —
    // the mock chain's .values() resolves via .then() with an empty array.
    const inserted = await insertStoryBatch(db, [story], authorMap);
    expect(inserted).toBe(1);
  });

  it("throws if author_id cannot be resolved (defense-in-depth)", async () => {
    const orphan = validStory({ author_id: "ORPHAN_PLACEHOLDER" });
    const emptyMap = new Map<string, string>();
    await expect(insertStoryBatch(db, [orphan], emptyMap)).rejects.toThrow(
      /Unknown author_id "ORPHAN_PLACEHOLDER"/,
    );
  });
});

// Phase 12e.8 — production guard. The guard runs at module-load time
// and calls process.exit(1), so it can't be tested in-process (it would
// kill the jest worker). spawnSync isolates it. Slow (~3s) but the only
// way to assert the runtime exit semantics.
describe("seedStories — production guard (12e.8)", () => {
  // Disabled by default in fast-feedback runs; enable via SEED_GUARD_TEST=1.
  // The spawn cost (npx ts-node startup, ~2-3s) isn't worth paying on
  // every jest run when the guard logic is a 4-line top-of-file check.
  const ENABLED = process.env.SEED_GUARD_TEST === "1";
  const maybeIt = ENABLED ? it : it.skip;

  maybeIt(
    "exits with code 1 when NODE_ENV=production, even with --yes",
    () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { spawnSync } = require("node:child_process") as typeof import("node:child_process");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const path = require("node:path") as typeof import("node:path");

      const script = path.resolve(__dirname, "../src/scripts/seedStories.ts");
      const result = spawnSync(
        "npx",
        ["ts-node", script, "--yes"],
        {
          env: {
            ...process.env,
            NODE_ENV: "production",
            // Provide a connection string so the guard isn't tripped on a
            // missing-DB error before NODE_ENV is even checked. The guard
            // runs before the DB import — but defensive.
            DATABASE_URL: "postgresql://noop:noop@localhost:1/noop",
          },
          encoding: "utf8",
          timeout: 30_000,
          shell: process.platform === "win32",
        },
      );

      expect(result.status).toBe(1);
      expect(result.stderr ?? "").toContain("refusing to run in production");
    },
    30_000,
  );
});
