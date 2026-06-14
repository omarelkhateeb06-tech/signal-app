import {
  sitemapAdapter,
  titleFromSlug,
} from "../../src/jobs/ingestion/adapters/sitemap";
import type { AdapterContext } from "../../src/jobs/ingestion/types";

const DAY_MS = 24 * 60 * 60 * 1000;

function makeCtx(overrides: Partial<AdapterContext> = {}): AdapterContext {
  return {
    sourceId: "00000000-0000-0000-0000-000000000030",
    slug: "anthropic-news",
    adapterType: "sitemap",
    endpoint: "https://www.anthropic.com/sitemap.xml",
    config: { pathPrefix: "/news/" },
    lastPolledAt: null,
    ...overrides,
  };
}

function daysAgoIso(n: number): string {
  return new Date(Date.now() - n * DAY_MS).toISOString();
}

interface Entry {
  loc: string;
  lastmod?: string | null;
}

function urlset(entries: Entry[]): string {
  const items = entries
    .map((e) => {
      const lm =
        e.lastmod === null || e.lastmod === undefined
          ? ""
          : `<lastmod>${e.lastmod}</lastmod>`;
      return `<url><loc>${e.loc}</loc>${lm}</url>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${items}</urlset>`;
}

function sitemapindex(locs: string[]): string {
  const items = locs.map((l) => `<sitemap><loc>${l}</loc></sitemap>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${items}</sitemapindex>`;
}

function xmlResponse(body: string): Response {
  return {
    status: 200,
    headers: { get: () => "application/xml" },
    text: async () => body,
  } as unknown as Response;
}

function errorResponse(status: number): Response {
  return {
    status,
    headers: { get: () => "text/plain" },
    text: async () => "error",
  } as unknown as Response;
}

// Route fetches by URL substring → an XML body or an HTTP error code.
function installFetchMock(routes: Array<[string, string | number]>): jest.Mock {
  const fn = jest.fn(async (url: string) => {
    for (const [key, val] of routes) {
      if (url.includes(key)) {
        return typeof val === "number" ? errorResponse(val) : xmlResponse(val);
      }
    }
    throw new Error("network");
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe("titleFromSlug", () => {
  it("preserves acronym case and spaces hyphenated slugs", () => {
    expect(titleFromSlug("https://www.anthropic.com/news/acquires-vercept")).toBe(
      "Acquires Vercept",
    );
    expect(
      titleFromSlug("https://www.anthropic.com/news/AI-enabled-cyber-threats-mitre-attack"),
    ).toBe("AI Enabled Cyber Threats Mitre Attack");
    expect(
      titleFromSlug("https://www.anthropic.com/news/advancing-claude-for-education"),
    ).toBe("Advancing Claude For Education");
  });

  it("handles a trailing slash and underscores", () => {
    expect(titleFromSlug("https://x.com/news/some_post/")).toBe("Some Post");
  });
});

describe("sitemapAdapter", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete (global as { fetch?: unknown }).fetch;
  });

  it("emits candidates for recent /news/ articles, newest first", async () => {
    installFetchMock([
      [
        "sitemap.xml",
        urlset([
          { loc: "https://www.anthropic.com/news/acquires-vercept", lastmod: daysAgoIso(2) },
          {
            loc: "https://www.anthropic.com/news/advancing-claude-for-education",
            lastmod: daysAgoIso(1),
          },
        ]),
      ],
    ]);
    const result = await sitemapAdapter(makeCtx());
    expect(result.candidates.length).toBe(2);

    // Newest first: education (1d) before vercept (2d).
    const [first, second] = result.candidates;
    expect(first!.title).toBe("Advancing Claude For Education");
    expect(second!.title).toBe("Acquires Vercept");

    expect(second!.url).toBe("https://www.anthropic.com/news/acquires-vercept");
    expect(second!.externalId).toBe(second!.url);
    expect(second!.summary).toBeNull();
    expect(second!.publishedAt).toBeInstanceOf(Date);
    expect(second!.rawPayload.source).toBe("sitemap");
  });

  it("drops old entries, off-prefix URLs, the listing page, and undated entries", async () => {
    installFetchMock([
      [
        "sitemap.xml",
        urlset([
          { loc: "https://www.anthropic.com/news/fresh-post", lastmod: daysAgoIso(1) },
          { loc: "https://www.anthropic.com/news/stale-post", lastmod: daysAgoIso(40) },
          { loc: "https://www.anthropic.com/research/some-paper", lastmod: daysAgoIso(1) },
          { loc: "https://www.anthropic.com/news/", lastmod: daysAgoIso(1) },
          { loc: "https://www.anthropic.com/news/no-date", lastmod: null },
        ]),
      ],
    ]);
    const result = await sitemapAdapter(makeCtx());
    expect(result.candidates.map((c) => c.url)).toEqual([
      "https://www.anthropic.com/news/fresh-post",
    ]);
  });

  it("honors a wider lookbackDays via config", async () => {
    installFetchMock([
      [
        "sitemap.xml",
        urlset([
          { loc: "https://www.anthropic.com/news/older-post", lastmod: daysAgoIso(20) },
        ]),
      ],
    ]);
    const dropped = await sitemapAdapter(makeCtx());
    expect(dropped.candidates.length).toBe(0); // 20d > default 7d

    const kept = await sitemapAdapter(
      makeCtx({ config: { pathPrefix: "/news/", lookbackDays: 30 } }),
    );
    expect(kept.candidates.length).toBe(1);
  });

  it("accepts all paths when no pathPrefix is configured", async () => {
    installFetchMock([
      [
        "sitemap.xml",
        urlset([
          { loc: "https://example.com/blog/a-post", lastmod: daysAgoIso(1) },
          { loc: "https://example.com/whitepaper", lastmod: daysAgoIso(1) },
        ]),
      ],
    ]);
    const result = await sitemapAdapter(makeCtx({ config: {} }));
    expect(result.candidates.length).toBe(2);
  });

  it("follows a sitemapindex, filtered by sitemapFilter", async () => {
    // Route order matters: the more-specific sub-sitemap substring is listed
    // before the root "sitemap.xml" so the root fetch falls through to the
    // index while the sub fetch resolves to the urlset.
    installFetchMock([
      [
        "sitemap.xml/news",
        urlset([
          { loc: "https://openai.com/index/a-launch", lastmod: daysAgoIso(1) },
        ]),
      ],
      [
        "sitemap.xml",
        sitemapindex([
          "https://openai.com/sitemap.xml/news/",
          "https://openai.com/sitemap.xml/careers/",
        ]),
      ],
    ]);
    const result = await sitemapAdapter(
      makeCtx({
        endpoint: "https://openai.com/sitemap.xml",
        config: { sitemapFilter: "/news/" },
      }),
    );
    // Only the /news/ sub-sitemap is followed; careers is filtered out.
    expect(result.candidates.length).toBe(1);
    expect(result.candidates[0]!.url).toBe("https://openai.com/index/a-launch");
  });

  it("continues past a sub-sitemap that fails to fetch", async () => {
    installFetchMock([
      ["sub-good", urlset([{ loc: "https://x.com/p/good", lastmod: daysAgoIso(1) }])],
      ["sub-bad", 503],
      [
        "root-sitemap.xml",
        sitemapindex(["https://x.com/sub-bad.xml", "https://x.com/sub-good.xml"]),
      ],
    ]);
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const result = await sitemapAdapter(
      makeCtx({ endpoint: "https://x.com/root-sitemap.xml", config: {} }),
    );
    expect(result.candidates.map((c) => c.url)).toEqual(["https://x.com/p/good"]);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("throws wrong_content_type on an HTML landing page (the openrss failure mode)", async () => {
    installFetchMock([
      ["sitemap.xml", "<!DOCTYPE html><html><head><title>openrss</title></head><body>nope</body></html>"],
    ]);
    await expect(sitemapAdapter(makeCtx())).rejects.toThrow("wrong_content_type");
  });

  it("caps at maxUrls, keeping the newest", async () => {
    installFetchMock([
      [
        "sitemap.xml",
        urlset([
          { loc: "https://www.anthropic.com/news/p-old", lastmod: daysAgoIso(3) },
          { loc: "https://www.anthropic.com/news/p-mid", lastmod: daysAgoIso(2) },
          { loc: "https://www.anthropic.com/news/p-new", lastmod: daysAgoIso(1) },
        ]),
      ],
    ]);
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const result = await sitemapAdapter(
      makeCtx({ config: { pathPrefix: "/news/", maxUrls: 2 } }),
    );
    expect(result.candidates.map((c) => c.url)).toEqual([
      "https://www.anthropic.com/news/p-new",
      "https://www.anthropic.com/news/p-mid",
    ]);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("capped at maxUrls=2"));
    logSpy.mockRestore();
  });
});
