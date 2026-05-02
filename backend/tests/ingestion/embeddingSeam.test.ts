/* eslint-disable @typescript-eslint/no-explicit-any */
import { createMockDb, type MockDb } from "../helpers/mockDb";
import {
  computeEmbedding,
  EMBEDDING_DIMENSIONS,
} from "../../src/jobs/ingestion/embeddingSeam";

const CANDIDATE_ID = "00000000-0000-0000-0000-0000000000ee";

let mock: MockDb;

beforeEach(() => {
  mock = createMockDb();
});

function fakeEmbedding(): number[] {
  return Array(EMBEDDING_DIMENSIONS).fill(0.1);
}

function makeOpenAI(create: jest.Mock): any {
  return {
    embeddings: { create },
  };
}

describe("computeEmbedding", () => {
  it("happy path: returns 1536-element embedding when SDK succeeds", async () => {
    mock.queueSelect([
      { rawTitle: "NVDA earnings beat", bodyText: "Revenue grew 100% YoY..." },
    ]);
    const create = jest
      .fn()
      .mockResolvedValue({ data: [{ embedding: fakeEmbedding() }] });
    const result = await computeEmbedding(CANDIDATE_ID, {
      db: mock.db,
      openai: makeOpenAI(create),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.embedding.length).toBe(EMBEDDING_DIMENSIONS);
    }
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      model: "text-embedding-3-small",
      input: "NVDA earnings beat\n\nRevenue grew 100% YoY...",
    });
  });

  it("returns embedding_empty_input when body_text is null", async () => {
    mock.queueSelect([{ rawTitle: "title", bodyText: null }]);
    const create = jest.fn();
    const result = await computeEmbedding(CANDIDATE_ID, {
      db: mock.db,
      openai: makeOpenAI(create),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejectionReason).toBe("embedding_empty_input");
    }
    expect(create).not.toHaveBeenCalled();
  });

  it("returns embedding_empty_input when body_text is whitespace", async () => {
    mock.queueSelect([{ rawTitle: "title", bodyText: "   \n   " }]);
    const create = jest.fn();
    const result = await computeEmbedding(CANDIDATE_ID, {
      db: mock.db,
      openai: makeOpenAI(create),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejectionReason).toBe("embedding_empty_input");
    }
    expect(create).not.toHaveBeenCalled();
  });

  it("returns embedding_api_error on SDK throw", async () => {
    mock.queueSelect([
      { rawTitle: "title", bodyText: "real body content" },
    ]);
    const create = jest
      .fn()
      .mockRejectedValue(new Error("network failure"));
    const result = await computeEmbedding(CANDIDATE_ID, {
      db: mock.db,
      openai: makeOpenAI(create),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejectionReason).toBe("embedding_api_error");
    }
  });

  it("returns embedding_rate_limited on HTTP 429", async () => {
    mock.queueSelect([
      { rawTitle: "title", bodyText: "real body content" },
    ]);
    const error: any = new Error("Rate limit");
    error.status = 429;
    const create = jest.fn().mockRejectedValue(error);
    const result = await computeEmbedding(CANDIDATE_ID, {
      db: mock.db,
      openai: makeOpenAI(create),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejectionReason).toBe("embedding_rate_limited");
    }
  });

  it("returns embedding_api_error when no openai client provided", async () => {
    const result = await computeEmbedding(CANDIDATE_ID, {
      db: mock.db,
      openai: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejectionReason).toBe("embedding_api_error");
    }
  });

  it("returns embedding_api_error when SDK returns wrong dimensions", async () => {
    mock.queueSelect([
      { rawTitle: "title", bodyText: "real body content" },
    ]);
    const create = jest
      .fn()
      .mockResolvedValue({ data: [{ embedding: [0.1, 0.2, 0.3] }] });
    const result = await computeEmbedding(CANDIDATE_ID, {
      db: mock.db,
      openai: makeOpenAI(create),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejectionReason).toBe("embedding_api_error");
    }
  });
});
