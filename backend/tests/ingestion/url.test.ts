import { canonicalizeUrl } from "../../src/utils/url";

describe("canonicalizeUrl", () => {
  describe("scheme + host", () => {
    it("lowercases scheme and host", () => {
      expect(canonicalizeUrl("HTTPS://EXAMPLE.COM/path")).toBe("https://example.com/path");
    });

    it("preserves path case", () => {
      expect(canonicalizeUrl("https://example.com/Path/MixedCase")).toBe(
        "https://example.com/Path/MixedCase",
      );
    });

    it("strips default port :80 on http", () => {
      expect(canonicalizeUrl("http://example.com:80/")).toBe("http://example.com/");
    });

    it("strips default port :443 on https", () => {
      expect(canonicalizeUrl("https://example.com:443/")).toBe("https://example.com/");
    });

    it("preserves non-default ports", () => {
      expect(canonicalizeUrl("https://example.com:8080/")).toBe("https://example.com:8080/");
    });
  });

  describe("fragment", () => {
    it("strips URL fragment", () => {
      expect(canonicalizeUrl("https://example.com/article#top")).toBe(
        "https://example.com/article",
      );
    });
  });

  describe("tracking params", () => {
    it.each([
      ["utm_source"],
      ["utm_medium"],
      ["utm_campaign"],
      ["utm_content"],
      ["utm_term"],
      ["fbclid"],
      ["gclid"],
      ["mc_cid"],
      ["mc_eid"],
      ["_ga"],
      ["ref"],
      ["ref_src"],
      ["mkt_tok"],
    ])("strips %s", (key) => {
      const url = `https://example.com/article?${key}=trackme`;
      expect(canonicalizeUrl(url)).toBe("https://example.com/article");
    });

    it("strips source=email but keeps source=user", () => {
      expect(canonicalizeUrl("https://example.com/x?source=email")).toBe(
        "https://example.com/x",
      );
      expect(canonicalizeUrl("https://example.com/x?source=rss")).toBe(
        "https://example.com/x",
      );
      expect(canonicalizeUrl("https://example.com/x?source=feed")).toBe(
        "https://example.com/x",
      );
      expect(canonicalizeUrl("https://example.com/x?source=user")).toBe(
        "https://example.com/x?source=user",
      );
    });

    it("preserves non-tracking query params", () => {
      expect(canonicalizeUrl("https://example.com/x?id=42&page=3")).toBe(
        "https://example.com/x?id=42&page=3",
      );
    });

    it("strips trackers while preserving non-tracker params", () => {
      expect(
        canonicalizeUrl("https://example.com/x?id=42&utm_source=newsletter&page=3"),
      ).toBe("https://example.com/x?id=42&page=3");
    });
  });

  describe("query param sorting", () => {
    it("sorts remaining params alphabetically by key", () => {
      expect(canonicalizeUrl("https://example.com/x?z=1&a=2&m=3")).toBe(
        "https://example.com/x?a=2&m=3&z=1",
      );
    });
  });

  describe("trailing slash", () => {
    it("preserves the root slash", () => {
      expect(canonicalizeUrl("https://example.com/")).toBe("https://example.com/");
    });

    it("preserves a single-segment trailing slash on its own", () => {
      // Single segment + trailing slash: rule says strip only if path has > 1 segment.
      // "/foo/" has one segment ("foo") — keep the slash.
      expect(canonicalizeUrl("https://example.com/foo/")).toBe(
        "https://example.com/foo/",
      );
    });

    it("strips trailing slash on multi-segment paths", () => {
      expect(canonicalizeUrl("https://example.com/foo/bar/")).toBe(
        "https://example.com/foo/bar",
      );
    });
  });

  describe("idempotence", () => {
    it("canonicalize twice equals canonicalize once", () => {
      const inputs = [
        "https://example.com/path?utm_source=x&id=1#frag",
        "HTTPS://Example.COM:443/Foo/Bar/?z=1&a=2",
        "http://example.com/article",
        "https://newsletter.semianalysis.com/p/the-coding-assistant-breakdown",
      ];
      for (const u of inputs) {
        const once = canonicalizeUrl(u);
        const twice = canonicalizeUrl(once);
        expect(twice).toBe(once);
      }
    });
  });
});
