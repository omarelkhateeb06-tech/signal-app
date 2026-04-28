import fs from "node:fs";
import path from "node:path";

import {
  DEFAULT_BODY_USER_AGENT,
  fetchAndExtractBody,
} from "../../src/jobs/ingestion/bodyExtractor";
import { BODY_SIZE_CAP_BYTES, HEURISTIC_REASONS } from "../../src/jobs/ingestion/heuristics";

const FIXTURES_DIR = path.resolve(__dirname, "../fixtures/articles");

function loadFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURES_DIR, name), "utf8");
}

function mockHtml(html: string, contentType = "text/html; charset=utf-8"): void {
  global.fetch = jest.fn().mockResolvedValue({
    status: 200,
    headers: {
      get: (k: string) =>
        k.toLowerCase() === "content-type" ? contentType : null,
    },
    text: async () => html,
  } as unknown as Response);
}

describe("fetchAndExtractBody", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete (global as { fetch?: unknown }).fetch;
  });

  describe("success against fixture HTML", () => {
    it("extracts body text from cnbc-markets fixture", async () => {
      mockHtml(loadFixture("cnbc-markets-sample.html"));
      const result = await fetchAndExtractBody(
        "https://www.cnbc.com/2026/04/16/tsmc-q1-profit-58-percent-ai-chip-demand-record.html",
        { userAgent: DEFAULT_BODY_USER_AGENT },
      );
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.text.length).toBeGreaterThan(500);
      expect(result.truncated).toBe(false);
    });

    it("extracts body text from import-ai fixture", async () => {
      mockHtml(loadFixture("import-ai-sample.html"));
      const result = await fetchAndExtractBody(
        "https://importai.substack.com/p/import-ai-436-another-2gw-datacenter",
        { userAgent: DEFAULT_BODY_USER_AGENT },
      );
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.text.length).toBeGreaterThan(500);
      expect(result.truncated).toBe(false);
    });

    it("extracts body text from semianalysis fixture", async () => {
      mockHtml(loadFixture("semianalysis-sample.html"));
      const result = await fetchAndExtractBody(
        "https://newsletter.semianalysis.com/p/aws-trainium3-deep-dive-a-potential",
        { userAgent: DEFAULT_BODY_USER_AGENT },
      );
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.text.length).toBeGreaterThan(500);
    });
  });

  describe("user-agent forwarding", () => {
    it("sends the supplied User-Agent on the fetch", async () => {
      mockHtml(
        `<!doctype html><html><body><article><h1>X</h1>${"<p>" + "lorem ipsum ".repeat(100) + "</p>"}</article></body></html>`,
      );
      await fetchAndExtractBody("https://example.com/x", { userAgent: "Custom-UA/1.0" });
      const fetchMock = global.fetch as jest.Mock;
      const headers = fetchMock.mock.calls[0]![1].headers;
      expect(headers["User-Agent"]).toBe("Custom-UA/1.0");
    });
  });

  describe("failure classification", () => {
    it("returns BODY_4XX on 404", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        status: 404,
        headers: { get: () => "text/html" },
        text: async () => "",
      } as unknown as Response);
      const result = await fetchAndExtractBody("https://example.com/x", {
        userAgent: DEFAULT_BODY_USER_AGENT,
      });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.reason).toBe(HEURISTIC_REASONS.BODY_4XX);
    });

    it("returns BODY_5XX on 503", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        status: 503,
        headers: { get: () => "text/html" },
        text: async () => "",
      } as unknown as Response);
      const result = await fetchAndExtractBody("https://example.com/x", {
        userAgent: DEFAULT_BODY_USER_AGENT,
      });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.reason).toBe(HEURISTIC_REASONS.BODY_5XX);
    });

    it("returns BODY_TIMEOUT on AbortError", async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      global.fetch = jest.fn().mockRejectedValue(err);
      const result = await fetchAndExtractBody("https://example.com/x", {
        userAgent: DEFAULT_BODY_USER_AGENT,
      });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.reason).toBe(HEURISTIC_REASONS.BODY_TIMEOUT);
    });

    it("returns BODY_NETWORK on generic fetch failure", async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error("ENOTFOUND"));
      const result = await fetchAndExtractBody("https://example.com/x", {
        userAgent: DEFAULT_BODY_USER_AGENT,
      });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.reason).toBe(HEURISTIC_REASONS.BODY_NETWORK);
    });

    it("returns BODY_WRONG_CONTENT_TYPE on application/json", async () => {
      mockHtml('{"x":1}', "application/json");
      const result = await fetchAndExtractBody("https://example.com/x", {
        userAgent: DEFAULT_BODY_USER_AGENT,
      });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.reason).toBe(HEURISTIC_REASONS.BODY_WRONG_CONTENT_TYPE);
    });

    it("returns BODY_PARSE_ERROR when readability returns null", async () => {
      // Tiny HTML with no extractable article content trips readability's
      // null-return path.
      mockHtml("<!doctype html><html><body><div></div></body></html>");
      const result = await fetchAndExtractBody("https://example.com/x", {
        userAgent: DEFAULT_BODY_USER_AGENT,
      });
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.reason).toBe(HEURISTIC_REASONS.BODY_PARSE_ERROR);
    });
  });

  describe("truncation at 200 KB cap", () => {
    it("truncates and flags truncated=true when extracted text exceeds cap", async () => {
      // Build an article with > 200 KB of paragraph text.
      const paragraph = "<p>" + "lorem ipsum dolor sit amet ".repeat(50) + "</p>";
      const giant = paragraph.repeat(2000); // ~2.5 MB raw HTML
      mockHtml(
        `<!doctype html><html><body><article><h1>Long</h1>${giant}</article></body></html>`,
      );
      const result = await fetchAndExtractBody("https://example.com/x", {
        userAgent: DEFAULT_BODY_USER_AGENT,
      });
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.truncated).toBe(true);
      expect(result.text.length).toBe(BODY_SIZE_CAP_BYTES);
    });

    it("does NOT truncate when text is below the cap", async () => {
      const paragraph = "<p>" + "x".repeat(800) + "</p>";
      mockHtml(
        `<!doctype html><html><body><article><h1>Short</h1>${paragraph}</article></body></html>`,
      );
      const result = await fetchAndExtractBody("https://example.com/x", {
        userAgent: DEFAULT_BODY_USER_AGENT,
      });
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.truncated).toBe(false);
      expect(result.text.length).toBeLessThan(BODY_SIZE_CAP_BYTES);
    });
  });
});
