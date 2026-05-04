import fs from "node:fs";
import path from "node:path";

import { rssAdapter } from "../../src/jobs/ingestion/adapters/rss";
import type { AdapterContext } from "../../src/jobs/ingestion/types";

const FIXTURES_DIR = path.resolve(__dirname, "../fixtures/feeds");

function loadFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURES_DIR, name), "utf8");
}

function mockOk(body: string, contentType = "application/xml; charset=utf-8"): void {
  global.fetch = jest.fn().mockResolvedValue({
    status: 200,
    headers: {
      get: (k: string) =>
        k.toLowerCase() === "content-type" ? contentType : null,
    },
    text: async () => body,
  } as unknown as Response);
}

function makeCtx(overrides: Partial<AdapterContext> = {}): AdapterContext {
  return {
    sourceId: "00000000-0000-0000-0000-000000000001",
    slug: "test-source",
    adapterType: "rss",
    endpoint: "https://example.com/feed",
    config: {},
    lastPolledAt: null,
    ...overrides,
  };
}

describe("rssAdapter", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete (global as { fetch?: unknown }).fetch;
  });

  describe("happy path against fixture feeds", () => {
    it("parses import-ai (Substack RSS 2.0)", async () => {
      mockOk(loadFixture("import-ai.xml"));
      const result = await rssAdapter(makeCtx({ slug: "import-ai" }));
      expect(result.candidates.length).toBe(20);
      const first = result.candidates[0]!;
      expect(typeof first.externalId).toBe("string");
      expect(first.externalId.length).toBeGreaterThan(0);
      expect(first.url.startsWith("https://")).toBe(true);
      expect(first.contentHash).toMatch(/^[0-9a-f]{32}$/);
    });

    it("parses semianalysis (Substack RSS 2.0, truncated fixture)", async () => {
      mockOk(loadFixture("semianalysis.xml"));
      const result = await rssAdapter(makeCtx({ slug: "semianalysis" }));
      expect(result.candidates.length).toBe(5);
      for (const c of result.candidates) {
        expect(c.contentHash).toMatch(/^[0-9a-f]{32}$/);
        expect(typeof c.externalId).toBe("string");
        expect(c.externalId.length).toBeGreaterThan(0);
      }
    });

    it("parses cnbc-markets (RSS 2.0, opaque numeric GUIDs)", async () => {
      mockOk(loadFixture("cnbc-markets.xml"));
      const result = await rssAdapter(makeCtx({ slug: "cnbc-markets" }));
      expect(result.candidates.length).toBe(30);
      // CNBC GUIDs are opaque numeric strings — verify externalId is set
      // verbatim from guid (not hash-derived).
      const first = result.candidates[0]!;
      expect(first.externalId).toMatch(/^\d+$/);
    });

    it("canonicalizes item URLs", async () => {
      // Synthesize a feed with a URL that should canonicalize.
      const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title><link>https://example.com</link><description>d</description>
        <item>
          <title>One</title>
          <link>HTTPS://Example.COM/Article?utm_source=feed&amp;id=42</link>
          <guid>guid-1</guid>
          <pubDate>Mon, 27 Apr 2026 12:00:00 GMT</pubDate>
        </item>
      </channel></rss>`;
      mockOk(xml);
      const result = await rssAdapter(makeCtx());
      expect(result.candidates[0]!.url).toBe("https://example.com/Article?id=42");
    });

    it("uses contentSnippet preferred over content for summary", async () => {
      const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title><link>https://example.com</link><description>d</description>
        <item>
          <title>One</title>
          <link>https://example.com/a</link>
          <guid>g1</guid>
          <pubDate>Mon, 27 Apr 2026 12:00:00 GMT</pubDate>
          <description>Short snippet</description>
          <content:encoded xmlns:content="http://purl.org/rss/1.0/modules/content/"><![CDATA[<p>Long body</p>]]></content:encoded>
        </item>
      </channel></rss>`;
      mockOk(xml);
      const result = await rssAdapter(makeCtx());
      // rss-parser maps <description> to contentSnippet; we prefer contentSnippet.
      expect(result.candidates[0]!.summary).toBe("Short snippet");
    });
  });

  describe("missing-GUID fallback", () => {
    it("uses SHA-256(link + pubDate) truncated to 32 chars when guid missing", async () => {
      const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title><link>https://example.com</link><description>d</description>
        <item>
          <title>No GUID</title>
          <link>https://example.com/article-1</link>
          <pubDate>Mon, 27 Apr 2026 12:00:00 GMT</pubDate>
        </item>
      </channel></rss>`;
      mockOk(xml);
      const result = await rssAdapter(makeCtx());
      const first = result.candidates[0]!;
      expect(first.externalId).toMatch(/^[0-9a-f]{32}$/);
    });
  });

  describe("per-source User-Agent override", () => {
    it("sends config.userAgent when set", async () => {
      const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title><link>https://example.com</link><description>d</description></channel></rss>`;
      mockOk(xml);
      await rssAdapter(makeCtx({ config: { userAgent: "Custom-UA/1.0" } }));
      const fetchMock = global.fetch as jest.Mock;
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const headers = fetchMock.mock.calls[0]![1].headers;
      expect(headers["User-Agent"]).toBe("Custom-UA/1.0");
    });

    it("sends default UA when config.userAgent is missing", async () => {
      const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title><link>https://example.com</link><description>d</description></channel></rss>`;
      mockOk(xml);
      await rssAdapter(makeCtx({ config: {} }));
      const fetchMock = global.fetch as jest.Mock;
      const headers = fetchMock.mock.calls[0]![1].headers;
      expect(headers["User-Agent"]).toBe("SIGNAL/12e.2 (+contact@signal.so)");
    });
  });

  describe("failure classification", () => {
    it("throws http_4xx on 404", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        status: 404,
        headers: { get: () => "text/html" },
        text: async () => "<html>not found</html>",
      } as unknown as Response);
      await expect(rssAdapter(makeCtx())).rejects.toThrow("http_4xx");
    });

    it("throws http_5xx on 503", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        status: 503,
        headers: { get: () => "text/html" },
        text: async () => "",
      } as unknown as Response);
      await expect(rssAdapter(makeCtx())).rejects.toThrow("http_5xx");
    });

    it("throws timeout on AbortError", async () => {
      const abortErr = new Error("aborted");
      abortErr.name = "AbortError";
      global.fetch = jest.fn().mockRejectedValue(abortErr);
      await expect(rssAdapter(makeCtx())).rejects.toThrow("timeout");
    });

    it("throws network on generic fetch failure", async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error("ENOTFOUND"));
      await expect(rssAdapter(makeCtx())).rejects.toThrow("network");
    });

    it("throws wrong_content_type on text/html response", async () => {
      mockOk("<html>...</html>", "text/html; charset=utf-8");
      await expect(rssAdapter(makeCtx())).rejects.toThrow("wrong_content_type");
    });

    it("throws parse_error on malformed XML", async () => {
      mockOk("<not-xml-at-all>{}{}{}", "application/xml");
      await expect(rssAdapter(makeCtx())).rejects.toThrow("parse_error");
    });

    it("throws network when endpoint is null", async () => {
      await expect(
        rssAdapter(makeCtx({ endpoint: null })),
      ).rejects.toThrow("network");
    });
  });

  describe("form-type allowlist (SEC EDGAR full-feed filter)", () => {
    const buildEdgarLikeFeed = (): string => `<?xml version="1.0"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <title>EDGAR</title>
        <entry>
          <title>8-K - Apple Inc. (0000320193) (Filer)</title>
          <link href="https://www.sec.gov/cgi-bin/browse-edgar?id=1"/>
          <id>urn:tag:8-k-1</id>
          <updated>2026-04-27T12:00:00Z</updated>
          <summary>filing</summary>
        </entry>
        <entry>
          <title>424B2 - Bank Inc. (0000123456) (Filer)</title>
          <link href="https://www.sec.gov/cgi-bin/browse-edgar?id=2"/>
          <id>urn:tag:424b2-1</id>
          <updated>2026-04-27T12:00:00Z</updated>
          <summary>filing</summary>
        </entry>
        <entry>
          <title>13F-HR - Fund Co. (0000999999) (Filer)</title>
          <link href="https://www.sec.gov/cgi-bin/browse-edgar?id=3"/>
          <id>urn:tag:13f-1</id>
          <updated>2026-04-27T12:00:00Z</updated>
          <summary>filing</summary>
        </entry>
        <entry>
          <title>10-K - Other Corp. (0000111111) (Filer)</title>
          <link href="https://www.sec.gov/cgi-bin/browse-edgar?id=4"/>
          <id>urn:tag:10-k-1</id>
          <updated>2026-04-27T12:00:00Z</updated>
          <summary>filing</summary>
        </entry>
      </feed>`;

    it("keeps only items whose form-type prefix is in the allowlist", async () => {
      mockOk(buildEdgarLikeFeed(), "application/atom+xml");
      const result = await rssAdapter(
        makeCtx({
          config: { formTypeAllowlist: ["8-K", "10-K"] },
        }),
      );
      const titles = result.candidates.map((c) => c.title);
      expect(titles).toEqual(
        expect.arrayContaining([
          expect.stringContaining("8-K"),
          expect.stringContaining("10-K"),
        ]),
      );
      expect(result.candidates).toHaveLength(2);
    });

    it("drops items whose title doesn't start with a recognizable form prefix", async () => {
      const xml = `<?xml version="1.0"?>
        <feed xmlns="http://www.w3.org/2005/Atom">
          <title>EDGAR</title>
          <entry>
            <title>No separator title</title>
            <link href="https://example.com/x"/>
            <id>urn:1</id>
            <updated>2026-04-27T12:00:00Z</updated>
            <summary>x</summary>
          </entry>
        </feed>`;
      mockOk(xml, "application/atom+xml");
      const result = await rssAdapter(
        makeCtx({ config: { formTypeAllowlist: ["8-K"] } }),
      );
      expect(result.candidates).toHaveLength(0);
    });

    it("is a no-op when allowlist is unset", async () => {
      mockOk(buildEdgarLikeFeed(), "application/atom+xml");
      const result = await rssAdapter(makeCtx({ config: {} }));
      expect(result.candidates).toHaveLength(4);
    });

    it("is a no-op when allowlist is an empty array", async () => {
      mockOk(buildEdgarLikeFeed(), "application/atom+xml");
      const result = await rssAdapter(
        makeCtx({ config: { formTypeAllowlist: [] } }),
      );
      expect(result.candidates).toHaveLength(4);
    });
  });

  describe("HTML stripping at ingestion (12e.x)", () => {
    it("strips tags and decodes entities from item description", async () => {
      const xml = `<?xml version="1.0"?><rss version="2.0"><channel>
        <title>t</title><link>https://example.com</link><description>d</description>
        <item>
          <title>Filing</title>
          <link>https://example.com/a</link>
          <guid>g1</guid>
          <pubDate>Mon, 27 Apr 2026 12:00:00 GMT</pubDate>
          <description><![CDATA[<b>Filed:</b> 2026-04-27<br/><a href="https://x">link</a> &amp; more]]></description>
        </item>
      </channel></rss>`;
      mockOk(xml);
      const result = await rssAdapter(makeCtx());
      const summary = result.candidates[0]!.summary;
      expect(typeof summary).toBe("string");
      expect(summary).not.toMatch(/<[^>]+>/);
      expect(summary).not.toContain("&amp;");
      expect(summary).toContain("Filed:");
      expect(summary).toContain("link");
      expect(summary).toContain("&");
    });
  });
});
