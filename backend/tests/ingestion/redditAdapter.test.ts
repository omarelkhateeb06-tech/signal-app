import { redditAdapter } from "../../src/jobs/ingestion/adapters/reddit";
import type { AdapterContext } from "../../src/jobs/ingestion/types";

const RECENT_UTC = Math.floor(Date.now() / 1000) - 3600; // 1h ago

function makeCtx(overrides: Partial<AdapterContext> = {}): AdapterContext {
  return {
    sourceId: "00000000-0000-0000-0000-000000000040",
    slug: "reddit-finance",
    adapterType: "reddit_api",
    endpoint: null,
    config: { subreddits: ["SecurityAnalysis"], minScore: 100 },
    lastPolledAt: null,
    ...overrides,
  };
}

interface PostData {
  name: string;
  id?: string;
  title?: string;
  url?: string;
  permalink?: string;
  selftext?: string;
  is_self?: boolean;
  score?: number;
  created_utc?: number;
  stickied?: boolean;
  over_18?: boolean;
}

function post(overrides: Partial<PostData> & { name: string }): PostData {
  return {
    id: overrides.name.replace(/^t3_/, ""),
    title: "A Post",
    url: "https://example.com/article",
    permalink: `/r/SecurityAnalysis/comments/${overrides.name.replace(/^t3_/, "")}/x/`,
    selftext: "",
    is_self: false,
    score: 150,
    created_utc: RECENT_UTC,
    stickied: false,
    over_18: false,
    ...overrides,
  };
}

function jsonResponse(payload: unknown): Response {
  return {
    status: 200,
    headers: { get: () => "application/json" },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as unknown as Response;
}

function errorResponse(status: number): Response {
  return {
    status,
    headers: { get: () => "text/plain" },
    json: async () => ({}),
    text: async () => "error",
  } as unknown as Response;
}

function listing(posts: PostData[]): unknown {
  return { data: { children: posts.map((p) => ({ kind: "t3", data: p })) } };
}

interface MockOpts {
  token?: string | "empty" | number;
  subs: Record<string, PostData[] | number>;
}

function installRedditMock(opts: MockOpts): jest.Mock {
  const fn = jest.fn(async (url: string) => {
    if (url.includes("access_token")) {
      if (typeof opts.token === "number") return errorResponse(opts.token);
      if (opts.token === "empty") return jsonResponse({});
      return jsonResponse({
        access_token: opts.token ?? "test-token",
        token_type: "bearer",
        expires_in: 86400,
      });
    }
    const m = /\/r\/([^/]+)\/top/.exec(url);
    const sub = m?.[1];
    const entry = sub ? opts.subs[sub] : undefined;
    if (entry === undefined) throw new Error("network");
    if (typeof entry === "number") return errorResponse(entry);
    return jsonResponse(listing(entry));
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe("redditAdapter", () => {
  const ORIG_ID = process.env.REDDIT_CLIENT_ID;
  const ORIG_SECRET = process.env.REDDIT_CLIENT_SECRET;

  beforeEach(() => {
    process.env.REDDIT_CLIENT_ID = "cid";
    process.env.REDDIT_CLIENT_SECRET = "csecret";
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete (global as { fetch?: unknown }).fetch;
  });

  afterAll(() => {
    if (ORIG_ID === undefined) delete process.env.REDDIT_CLIENT_ID;
    else process.env.REDDIT_CLIENT_ID = ORIG_ID;
    if (ORIG_SECRET === undefined) delete process.env.REDDIT_CLIENT_SECRET;
    else process.env.REDDIT_CLIENT_SECRET = ORIG_SECRET;
  });

  it("authenticates then builds a candidate for a link post", async () => {
    const fn = installRedditMock({
      subs: {
        SecurityAnalysis: [
          post({ name: "t3_link1", title: "Deep value in X", url: "https://news.com/x", score: 200 }),
        ],
      },
    });
    const result = await redditAdapter(makeCtx());
    expect(result.candidates.length).toBe(1);
    const c = result.candidates[0]!;
    expect(c.externalId).toBe("t3_link1");
    expect(c.url).toBe("https://news.com/x");
    expect(c.title).toBe("Deep value in X");
    expect(c.bodyText).toBeNull(); // link post → body seam fetches the article
    expect(c.publishedAt).toBeInstanceOf(Date);
    expect(c.rawPayload.subreddit).toBe("SecurityAnalysis");

    // OAuth POST carried Basic auth + grant_type; listing used a bearer token.
    const tokenCall = fn.mock.calls.find((c2) => String(c2[0]).includes("access_token"))!;
    expect((tokenCall[1] as RequestInit).method).toBe("POST");
    expect(String((tokenCall[1] as RequestInit).headers!["Authorization" as never])).toMatch(/^Basic /);
    const listCall = fn.mock.calls.find((c2) => String(c2[0]).includes("/top"))!;
    expect(String((listCall[1] as RequestInit).headers!["Authorization" as never])).toBe(
      "Bearer test-token",
    );
  });

  it("carries selftext as bodyText for a self post and points url at the permalink", async () => {
    installRedditMock({
      subs: {
        SecurityAnalysis: [
          post({
            name: "t3_self1",
            is_self: true,
            url: "https://www.reddit.com/r/SecurityAnalysis/comments/self1/x/",
            permalink: "/r/SecurityAnalysis/comments/self1/x/",
            selftext: "A long-form DD writeup ".repeat(20),
            score: 300,
          }),
        ],
      },
    });
    const result = await redditAdapter(makeCtx());
    expect(result.candidates.length).toBe(1);
    const c = result.candidates[0]!;
    expect(c.url).toBe("https://www.reddit.com/r/SecurityAnalysis/comments/self1/x/");
    expect(c.bodyText).toContain("long-form DD writeup");
    expect(c.rawPayload.is_community_post).toBe(true);
  });

  it("drops below-score, stickied, NSFW, and contentless posts", async () => {
    installRedditMock({
      subs: {
        SecurityAnalysis: [
          post({ name: "t3_low", score: 12 }), // below minScore 100
          post({ name: "t3_pin", score: 500, stickied: true }), // mod pin
          post({ name: "t3_nsfw", score: 500, over_18: true }), // NSFW
          post({ name: "t3_emptyself", is_self: true, selftext: "", score: 500 }), // no body
          post({ name: "t3_nolink", is_self: false, url: "", score: 500 }), // no url
          post({ name: "t3_good", score: 150 }), // the only keeper
        ],
      },
    });
    const result = await redditAdapter(makeCtx());
    expect(result.candidates.map((c) => c.externalId)).toEqual(["t3_good"]);
  });

  it("returns no candidates and makes no requests when creds are unset", async () => {
    delete process.env.REDDIT_CLIENT_ID;
    const fn = installRedditMock({ subs: { SecurityAnalysis: [post({ name: "t3_x" })] } });
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const result = await redditAdapter(makeCtx());
    expect(result.candidates.length).toBe(0);
    expect(fn).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET unset"),
    );
  });

  it("dedups a post that appears in two subreddits' top listings", async () => {
    const shared = post({ name: "t3_shared", score: 400 });
    installRedditMock({
      subs: {
        SecurityAnalysis: [shared],
        investing: [shared, post({ name: "t3_other", score: 200 })],
      },
    });
    const result = await redditAdapter(
      makeCtx({ config: { subreddits: ["SecurityAnalysis", "investing"], minScore: 100 } }),
    );
    expect(result.candidates.map((c) => c.externalId).sort()).toEqual([
      "t3_other",
      "t3_shared",
    ]);
  });

  it("continues past a subreddit that fails to fetch", async () => {
    installRedditMock({
      subs: {
        SecurityAnalysis: 503, // persistent 5xx (exhausts retries)
        investing: [post({ name: "t3_ok", score: 250 })],
      },
    });
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const result = await redditAdapter(
      makeCtx({ config: { subreddits: ["SecurityAnalysis", "investing"], minScore: 100 } }),
    );
    expect(result.candidates.map((c) => c.externalId)).toEqual(["t3_ok"]);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("r/SecurityAnalysis failed"),
      "http_5xx",
    );
    errorSpy.mockRestore();
  });

  it("throws when the token response carries no access_token (bad creds)", async () => {
    installRedditMock({ token: "empty", subs: { SecurityAnalysis: [] } });
    await expect(redditAdapter(makeCtx())).rejects.toThrow("http_4xx");
  });
});
