/* eslint-disable @typescript-eslint/no-explicit-any */
import { createMockDb, type MockDb } from "../helpers/mockDb";
import { checkCluster } from "../../src/jobs/ingestion/clusterCheckSeam";

let mock: MockDb;

beforeEach(() => {
  mock = createMockDb();
});

function fakeEmbedding(): number[] {
  return Array(1536).fill(0.5);
}

// Override the mockDb's execute to return queued rows. Each test queues a
// single result; the helper dispenses them in order.
function setupExecute(rows: Array<{ id: string; similarity: number }>): void {
  mock.db.execute = jest.fn().mockResolvedValue({ rows });
}

describe("checkCluster", () => {
  it("returns matched=true when top similarity meets threshold", async () => {
    setupExecute([{ id: "evt-1", similarity: 0.92 }]);
    const result = await checkCluster(fakeEmbedding(), {
      db: mock.db,
      threshold: 0.85,
    });
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.matchedEventId).toBe("evt-1");
      expect(result.similarity).toBeCloseTo(0.92, 5);
    }
  });

  it("returns matched=false when no rows in window", async () => {
    setupExecute([]);
    const result = await checkCluster(fakeEmbedding(), {
      db: mock.db,
      threshold: 0.85,
    });
    expect(result.matched).toBe(false);
  });

  it("returns matched=false when top similarity is below threshold", async () => {
    setupExecute([{ id: "evt-2", similarity: 0.74 }]);
    const result = await checkCluster(fakeEmbedding(), {
      db: mock.db,
      threshold: 0.85,
    });
    expect(result.matched).toBe(false);
  });

  it("returns matched=true when similarity exactly equals threshold", async () => {
    setupExecute([{ id: "evt-3", similarity: 0.85 }]);
    const result = await checkCluster(fakeEmbedding(), {
      db: mock.db,
      threshold: 0.85,
    });
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.matchedEventId).toBe("evt-3");
    }
  });

  it("falls back to default threshold (0.85) when env not set", async () => {
    const before = process.env.EMBEDDING_CLUSTER_THRESHOLD;
    delete process.env.EMBEDDING_CLUSTER_THRESHOLD;
    try {
      setupExecute([{ id: "evt-4", similarity: 0.86 }]);
      const result = await checkCluster(fakeEmbedding(), { db: mock.db });
      expect(result.matched).toBe(true);
    } finally {
      if (before !== undefined) process.env.EMBEDDING_CLUSTER_THRESHOLD = before;
    }
  });

  it("honors EMBEDDING_CLUSTER_THRESHOLD env override", async () => {
    const before = process.env.EMBEDDING_CLUSTER_THRESHOLD;
    process.env.EMBEDDING_CLUSTER_THRESHOLD = "0.95";
    try {
      setupExecute([{ id: "evt-5", similarity: 0.92 }]);
      const result = await checkCluster(fakeEmbedding(), { db: mock.db });
      expect(result.matched).toBe(false);
    } finally {
      if (before === undefined) delete process.env.EMBEDDING_CLUSTER_THRESHOLD;
      else process.env.EMBEDDING_CLUSTER_THRESHOLD = before;
    }
  });

  it("falls back to default when env value is non-numeric", async () => {
    const before = process.env.EMBEDDING_CLUSTER_THRESHOLD;
    process.env.EMBEDDING_CLUSTER_THRESHOLD = "garbage";
    try {
      setupExecute([{ id: "evt-6", similarity: 0.86 }]);
      const result = await checkCluster(fakeEmbedding(), { db: mock.db });
      expect(result.matched).toBe(true);
    } finally {
      if (before === undefined) delete process.env.EMBEDDING_CLUSTER_THRESHOLD;
      else process.env.EMBEDDING_CLUSTER_THRESHOLD = before;
    }
  });
});
