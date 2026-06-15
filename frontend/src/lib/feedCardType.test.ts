import { describe, expect, it } from "vitest";

import type { Story } from "@/types/story";
import {
  CARD_TYPE_LABEL,
  deriveCardType,
  isConnectionStory,
} from "./feedCardType";

function story(overrides: Partial<Story> = {}): Story {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    sector: "ai",
    headline: "Source article headline",
    context: "",
    why_it_matters: "",
    gated: false,
    kind: "ingested",
    why_it_matters_to_you: "",
    commentary: null,
    commentary_source: null,
    generic_commentary: null,
    generator_type: null,
    source_url: "https://example.com/a",
    source_name: "OutletA",
    primary_source_url: "https://example.com/a",
    sources: [{ url: "https://example.com/a", name: "OutletA", role: "primary" }],
    image_url: null,
    illustration_url: null,
    content_type: null,
    published_at: null,
    created_at: "2026-05-10T00:00:00Z",
    author: null,
    is_saved: false,
    save_count: 0,
    comment_count: 0,
    signal_rating: 72,
    ...overrides,
  };
}

function withSources(n: number): Story["sources"] {
  return Array.from({ length: n }, (_, i) => ({
    url: `https://example.com/${i}`,
    name: `Outlet${i}`,
    role: i === 0 ? ("primary" as const) : ("alternate" as const),
  }));
}

describe("deriveCardType — native generators", () => {
  it("maps the cross-sector chain to the hero connection type", () => {
    const d = deriveCardType(
      story({ kind: "native", generator_type: "cross-sector-chain-native" }),
    );
    expect(d.type).toBe("connection");
    expect(d.label).toBe("THE CONNECTION");
    expect(d.isHero).toBe(true);
  });

  it("maps the arxiv synthesis to the research read", () => {
    const d = deriveCardType(
      story({ kind: "native", generator_type: "arxiv-synthesis-native" }),
    );
    expect(d.type).toBe("research");
    expect(d.label).toBe("THE RESEARCH READ");
    expect(d.isHero).toBe(false);
  });

  it("maps the HN synthesis to the practitioner brief", () => {
    expect(
      deriveCardType(
        story({ kind: "native", generator_type: "hn-synthesis-native" }),
      ).type,
    ).toBe("practitioner");
  });

  it("maps the tool spotlight to worth-an-afternoon", () => {
    expect(
      deriveCardType(
        story({ kind: "native", generator_type: "tool-spotlight-native" }),
      ).type,
    ).toBe("tool");
  });

  it("maps the YouTube episode generators to the dispatch brand", () => {
    for (const slug of [
      "youtube-dwarkesh-native",
      "youtube-asianometry-native",
      "youtube-techtechpotato-native",
      "youtube-nopriors-native",
      "youtube-acquired-native",
    ]) {
      const d = deriveCardType(story({ kind: "native", generator_type: slug }));
      expect(d.type).toBe("dispatch");
      expect(d.label).toBe("DISPATCH");
      expect(d.isHero).toBe(false);
    }
  });

  it("falls back to the generic SIGNAL ORIGINAL for an unmapped native generator", () => {
    const d = deriveCardType(
      story({ kind: "native", generator_type: "github-trending-native" }),
    );
    expect(d.type).toBe("native");
    expect(d.label).toBe("SIGNAL ORIGINAL");
  });

  it("falls back to native when a native post has no generator", () => {
    expect(
      deriveCardType(story({ kind: "native", generator_type: null })).type,
    ).toBe("native");
  });
});

describe("deriveCardType — ingested stories", () => {
  it("treats a multi-source ingested event as a cluster", () => {
    const d = deriveCardType(
      story({ kind: "ingested", sources: withSources(3) }),
    );
    expect(d.type).toBe("cluster");
    expect(d.label).toBe("MULTI-SOURCE");
    expect(d.isHero).toBe(false);
  });

  it("treats a single-source ingested story as a dispatch", () => {
    expect(
      deriveCardType(story({ kind: "ingested", sources: withSources(1) })).type,
    ).toBe("dispatch");
  });

  it("ignores generator_type on ingested stories (only kind=native maps it)", () => {
    // A stray generator slug on an ingested row must not promote it to a
    // branded native type — kind is the gate.
    expect(
      deriveCardType(
        story({
          kind: "ingested",
          generator_type: "cross-sector-chain-native",
          sources: withSources(1),
        }),
      ).type,
    ).toBe("dispatch");
  });
});

describe("deriveCardType — earnings / SEC filings", () => {
  it("maps an ingested filing to the earnings card", () => {
    const d = deriveCardType(
      story({ kind: "ingested", content_type: "filing", sector: "finance" }),
    );
    expect(d.type).toBe("earnings");
    expect(d.label).toBe("EARNINGS / SEC");
    expect(d.isHero).toBe(false);
  });

  it("prioritizes a filing over multi-source clustering", () => {
    // A SEC filing covered by several outlets is still a filing, not a
    // generic cluster — content_type wins over source breadth.
    expect(
      deriveCardType(
        story({
          kind: "ingested",
          content_type: "filing",
          sources: withSources(4),
        }),
      ).type,
    ).toBe("earnings");
  });

  it("maps the native earnings-reaction generator to the earnings card", () => {
    expect(
      deriveCardType(
        story({ kind: "native", generator_type: "earnings-reaction-native" }),
      ).type,
    ).toBe("earnings");
  });
});

describe("deriveCardType — launches (Product Hunt etc.)", () => {
  it("maps an ingested 'launch' content_type to THE LAUNCH", () => {
    const d = deriveCardType(
      story({ kind: "ingested", content_type: "launch" }),
    );
    expect(d.type).toBe("launch");
    expect(d.label).toBe("THE LAUNCH");
    expect(d.isHero).toBe(false);
  });

  it("prioritizes a launch over multi-source clustering", () => {
    expect(
      deriveCardType(
        story({
          kind: "ingested",
          content_type: "launch",
          sources: withSources(3),
        }),
      ).type,
    ).toBe("launch");
  });

  it("maps an ingested 'tool' content_type (GitHub) to WORTH AN AFTERNOON", () => {
    const d = deriveCardType(
      story({ kind: "ingested", content_type: "tool" }),
    );
    expect(d.type).toBe("tool");
    expect(d.label).toBe("WORTH AN AFTERNOON");
  });
});

describe("isConnectionStory", () => {
  it("is true only for the cross-sector chain", () => {
    expect(
      isConnectionStory(
        story({ kind: "native", generator_type: "cross-sector-chain-native" }),
      ),
    ).toBe(true);
    expect(
      isConnectionStory(
        story({ kind: "native", generator_type: "arxiv-synthesis-native" }),
      ),
    ).toBe(false);
    expect(isConnectionStory(story({ kind: "ingested" }))).toBe(false);
  });
});

describe("CARD_TYPE_LABEL", () => {
  it("has a label for every card type", () => {
    const types = [
      "connection",
      "research",
      "practitioner",
      "tool",
      "earnings",
      "launch",
      "native",
      "cluster",
      "dispatch",
    ] as const;
    for (const t of types) {
      expect(CARD_TYPE_LABEL[t]).toBeTruthy();
    }
  });
});
