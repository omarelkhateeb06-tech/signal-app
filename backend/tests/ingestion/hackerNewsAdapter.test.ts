import { hackerNewsAdapter } from "../../src/jobs/ingestion/adapters/hackerNews";
import type { AdapterContext } from "../../src/jobs/ingestion/types";

const HN_BASE = "https://hacker-news.firebaseio.com/v0";

function makeCtx(overrides: Partial<AdapterContext> = {}): AdapterContext {
  return {
    sourceId: "00000000-0000-0000-0000-000000000003",
    slug: "hackernews",
    adapterType: "hackernews_api",
    endpoint: `${HN_BASE}/topstories.json`,
    config: {},
    lastPolledAt: null,
    ...overrides,
  };
}

interface HnItemFixture {
  id: number;
  type?: string;
  title?: string;
  url?: string;
  score?: number;
  time?: number;
  dead?: boolean;
  deleted?: boolean;
}

interface MockHnArgs {
  topIds: number[] | { status: number };
  items?: Record<number, HnItemFixture | { reject: true } | null>;
}

// Routes fetch calls by URL: topstories or item/{id}.
function mockHn({ topIds, items = {} }: MockHnArgs): jest.Mock {
  const fn = jest.fn(async (url: string) => {
    if (url.endsWith("/topstories.json")) {
      if (!Array.isArray(topIds) && typeof topIds === "object" && "status" in topIds) {
        return {
          status: topIds.status,
          headers: { get: () => "text/plain" },
          json: async () => null,
        } as unknown as Response;
      }
      return {
        status: 200,
        headers: { get: () => "application/json" },
        json: async () => topIds,
      } as unknown as Response;
    }
    const m = /\/item\/(\d+)\.json$/.exec(url);
    if (!m) throw new Error(`unexpected url: ${url}`);
    const id = Number(m[1]);
    const fixture = items[id];
    if (fixture && typeof fixture === "object" && "reject" in fixture && fixture.reject) {
      throw new Error("ENOTFOUND");
    }
    return {
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => fixture ?? null,
    } as unknown as Response;
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

function story(id: number, overrides: Partial<HnItemFixture> = {}): HnItemFixture {
  return {
    id,
    type: "story",
    title: `Story ${id}`,
    url: `https://example.com/${id}`,
    score: 200,
    time: 1714000000,
    ...overrides,
  };
}

describe("hackerNewsAdapter", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete (global as { fetch?: unknown }).fetch;
  });

  describe("happy path", () => {
    it("emits one candidate per usable story and filters the rest", async () => {
      mockHn({
        topIds: [1, 2, 3, 4, 5],
        items: {
          1: story(1, { score: 250 }),
          2: story(2, { type: "job" }),
          3: story(3, { score: 50 }),
          4: story(4, { url: "" }),
          5: story(5, { dead: true }),
        },
      });
      const result = await hackerNewsAdapter(makeCtx());
      expect(result.candidates.length).toBe(1);
      expect(result.candidates[0]!.externalId).toBe("1");
      expect(result.candidates[0]!.url).toBe("https://example.com/1");
      expect(result.candidates[0]!.title).toBe("Story 1");
      expect(result.candidates[0]!.summary).toBeNull();
    });

    it("emits 32-char hex contentHash and Date for publishedAt", async () => {
      mockHn({
        topIds: [42],
        items: { 42: story(42, { time: 1714000000 }) },
      });
      const result = await hackerNewsAdapter(makeCtx());
      expect(result.candidates[0]!.contentHash).toMatch(/^[0-9a-f]{32}$/);
      expect(result.candidates[0]!.publishedAt).toBeInstanceOf(Date);
      expect(result.candidates[0]!.publishedAt!.toISOString()).toBe(
        new Date(1714000000 * 1000).toISOString(),
      );
    });
  });

  describe("volume cap", () => {
    it("fetches only the first 150 IDs even when topstories returns 300", async () => {
      const ids = Array.from({ length: 300 }, (_, i) => i + 1);
      const items: Record<number, HnItemFixture> = {};
      for (const id of ids) items[id] = story(id);
      const fetchMock = mockHn({ topIds: ids, items });

      const result = await hackerNewsAdapter(makeCtx());
      // 1 topstories call + 150 item calls = 151.
      expect(fetchMock).toHaveBeenCalledTimes(151);
      expect(result.candidates.length).toBe(150);
      expect(result.candidates[0]!.externalId).toBe("1");
      expect(result.candidates[149]!.externalId).toBe("150");
    });
  });

  describe("filter exclusions", () => {
    it("excludes dead:true items", async () => {
      mockHn({ topIds: [1], items: { 1: story(1, { dead: true }) } });
      const result = await hackerNewsAdapter(makeCtx());
      expect(result.candidates).toEqual([]);
    });

    it("excludes deleted:true items", async () => {
      mockHn({ topIds: [1], items: { 1: story(1, { deleted: true }) } });
      const result = await hackerNewsAdapter(makeCtx());
      expect(result.candidates).toEqual([]);
    });

    it('excludes type:"job"', async () => {
      mockHn({ topIds: [1], items: { 1: story(1, { type: "job" }) } });
      const result = await hackerNewsAdapter(makeCtx());
      expect(result.candidates).toEqual([]);
    });

    it("excludes items with no url (Ask HN / Show HN with no link)", async () => {
      mockHn({ topIds: [1], items: { 1: story(1, { url: undefined }) } });
      const result = await hackerNewsAdapter(makeCtx());
      expect(result.candidates).toEqual([]);
    });

    it("excludes items with score below 100", async () => {
      mockHn({ topIds: [1], items: { 1: story(1, { score: 99 }) } });
      const result = await hackerNewsAdapter(makeCtx());
      expect(result.candidates).toEqual([]);
    });

    it("includes items at exactly score 100", async () => {
      mockHn({ topIds: [1], items: { 1: story(1, { score: 100 }) } });
      const result = await hackerNewsAdapter(makeCtx());
      expect(result.candidates.length).toBe(1);
    });
  });

  describe("topstories failure", () => {
    it("throws http_4xx when topstories returns 404", async () => {
      mockHn({ topIds: { status: 404 } });
      await expect(hackerNewsAdapter(makeCtx())).rejects.toThrow("http_4xx");
    });

    it("throws parse_error when topstories returns non-array", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        headers: { get: () => "application/json" },
        json: async () => ({ not: "an array" }),
      } as unknown as Response);
      await expect(hackerNewsAdapter(makeCtx())).rejects.toThrow("parse_error");
    });
  });

  describe("individual item fetch failure", () => {
    it("silently drops the failing item and emits the rest", async () => {
      mockHn({
        topIds: [1, 2, 3],
        items: {
          1: story(1),
          2: { reject: true },
          3: story(3),
        },
      });
      const result = await hackerNewsAdapter(makeCtx());
      expect(result.candidates.length).toBe(2);
      expect(result.candidates.map((c) => c.externalId)).toEqual(["1", "3"]);
    });
  });
});
