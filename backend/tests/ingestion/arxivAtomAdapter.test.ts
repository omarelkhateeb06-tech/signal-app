import { arxivAtomAdapter } from "../../src/jobs/ingestion/adapters/arxivAtom";
import type { AdapterContext } from "../../src/jobs/ingestion/types";

function makeCtx(overrides: Partial<AdapterContext> = {}): AdapterContext {
  return {
    sourceId: "00000000-0000-0000-0000-000000000001",
    slug: "arxiv-ai-cl-lg",
    adapterType: "arxiv_atom",
    endpoint: "https://export.arxiv.org/api/query?search_query=cat:cs.AI",
    config: {},
    lastPolledAt: null,
    ...overrides,
  };
}

function mockOk(body: string): void {
  global.fetch = jest.fn().mockResolvedValue({
    status: 200,
    headers: { get: () => "application/atom+xml" },
    text: async () => body,
  } as unknown as Response);
}

function buildAtom(entries: { id: string; title: string; updated: string; summary?: string }[]): string {
  const items = entries
    .map(
      (e) => `
  <entry>
    <id>${e.id}</id>
    <updated>${e.updated}</updated>
    <published>${e.updated}</published>
    <title>${e.title}</title>
    <summary>${e.summary ?? "Abstract text for " + e.title}</summary>
    <link href="${e.id}" rel="alternate" type="text/html"/>
  </entry>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>arXiv Query</title>
  <link href="https://arxiv.org/" rel="alternate"/>
  <id>http://arxiv.org/api/query</id>
  <updated>2026-04-15T00:00:00Z</updated>
  ${items}
</feed>`;
}

describe("arxivAtomAdapter", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete (global as { fetch?: unknown }).fetch;
  });

  describe("happy path", () => {
    it("emits one candidate per entry with version-stripped externalId", async () => {
      const xml = buildAtom([
        {
          id: "http://arxiv.org/abs/2401.12345v2",
          title: "Scaling Laws for Mixture-of-Experts",
          updated: "2026-04-15T10:00:00Z",
        },
        {
          id: "http://arxiv.org/abs/2402.99999v1",
          title: "Attention Is Still All You Need",
          updated: "2026-04-14T12:00:00Z",
        },
      ]);
      mockOk(xml);
      const result = await arxivAtomAdapter(makeCtx());
      expect(result.candidates.length).toBe(2);
      expect(result.candidates[0]!.externalId).toBe("2401.12345");
      expect(result.candidates[1]!.externalId).toBe("2402.99999");
    });

    it("uses isoDate (Atom updated field) for publishedAt", async () => {
      const xml = buildAtom([
        {
          id: "http://arxiv.org/abs/2403.00001v1",
          title: "T",
          updated: "2026-04-10T08:30:00Z",
        },
      ]);
      mockOk(xml);
      const result = await arxivAtomAdapter(makeCtx());
      const pub = result.candidates[0]!.publishedAt;
      expect(pub).toBeInstanceOf(Date);
      expect(pub!.toISOString()).toBe("2026-04-10T08:30:00.000Z");
    });

    it("caps volume at 20 even when feed contains 30 entries", async () => {
      const entries = Array.from({ length: 30 }, (_, i) => ({
        id: `http://arxiv.org/abs/2404.${String(i).padStart(5, "0")}v1`,
        title: `Paper ${i}`,
        updated: "2026-04-15T00:00:00Z",
      }));
      const xml = buildAtom(entries);
      mockOk(xml);
      const result = await arxivAtomAdapter(makeCtx());
      expect(result.candidates.length).toBe(20);
      expect(result.candidates[0]!.externalId).toBe("2404.00000");
      expect(result.candidates[19]!.externalId).toBe("2404.00019");
    });

    it("emits 32-char hex contentHash", async () => {
      const xml = buildAtom([
        {
          id: "http://arxiv.org/abs/2401.00001v1",
          title: "T",
          updated: "2026-04-15T00:00:00Z",
        },
      ]);
      mockOk(xml);
      const result = await arxivAtomAdapter(makeCtx());
      expect(result.candidates[0]!.contentHash).toMatch(/^[0-9a-f]{32}$/);
    });

    it("populates summary from contentSnippet (Atom summary field)", async () => {
      const xml = buildAtom([
        {
          id: "http://arxiv.org/abs/2401.55555v1",
          title: "T",
          updated: "2026-04-15T00:00:00Z",
          summary: "A novel approach to scaling.",
        },
      ]);
      mockOk(xml);
      const result = await arxivAtomAdapter(makeCtx());
      expect(result.candidates[0]!.summary).toContain("novel approach to scaling");
    });
  });

  describe("failure classification", () => {
    it("throws timeout on AbortError", async () => {
      const abortErr = new Error("aborted");
      abortErr.name = "AbortError";
      global.fetch = jest.fn().mockRejectedValue(abortErr);
      await expect(arxivAtomAdapter(makeCtx())).rejects.toThrow("timeout");
    });

    it("throws network on generic fetch failure", async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error("ENOTFOUND"));
      await expect(arxivAtomAdapter(makeCtx())).rejects.toThrow("network");
    });

    it("throws http_4xx on 429 rate limit", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        status: 429,
        headers: { get: () => "text/plain" },
        text: async () => "rate limited",
      } as unknown as Response);
      await expect(arxivAtomAdapter(makeCtx())).rejects.toThrow("http_4xx");
    });

    it("throws http_5xx on 503", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        status: 503,
        headers: { get: () => "text/plain" },
        text: async () => "",
      } as unknown as Response);
      await expect(arxivAtomAdapter(makeCtx())).rejects.toThrow("http_5xx");
    });

    it("throws parse_error on malformed XML", async () => {
      mockOk("<not-an-atom-feed>{}{}{}");
      await expect(arxivAtomAdapter(makeCtx())).rejects.toThrow("parse_error");
    });

    it("throws network when endpoint is null", async () => {
      await expect(arxivAtomAdapter(makeCtx({ endpoint: null }))).rejects.toThrow("network");
    });
  });
});
