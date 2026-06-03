import { describe, expect, it } from "vitest";

import type { Story } from "@/types/story";
import {
  NATIVE_SOURCE_NAME,
  brandLabelForGeneratorType,
  isNativeStory,
  sourceDisplayLabel,
  splitHook,
} from "./feedCard";

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
    published_at: null,
    created_at: "2026-05-10T00:00:00Z",
    author: null,
    is_saved: false,
    save_count: 0,
    comment_count: 0,
    ...overrides,
  };
}

describe("isNativeStory", () => {
  it("is true when kind is native", () => {
    expect(isNativeStory(story({ kind: "native" }))).toBe(true);
  });

  it("is false for an ingested story", () => {
    expect(isNativeStory(story({ kind: "ingested" }))).toBe(false);
  });

  it("ignores the source display name — kind is authoritative", () => {
    // A story whose source name happens to read "SIGNAL" is still NOT
    // native unless the wire's `kind` says so. The string is no longer a
    // backbone.
    expect(
      isNativeStory(
        story({ kind: "ingested", source_name: NATIVE_SOURCE_NAME }),
      ),
    ).toBe(false);
  });
});

describe("sourceDisplayLabel", () => {
  it("maps a branded native generator to its brand label", () => {
    expect(
      sourceDisplayLabel(
        story({ kind: "native", source_name: NATIVE_SOURCE_NAME, generator_type: "arxiv-synthesis-native" }),
      ),
    ).toBe("The Research Read");
    expect(
      sourceDisplayLabel(
        story({ kind: "native", source_name: NATIVE_SOURCE_NAME, generator_type: "hn-synthesis-native" }),
      ),
    ).toBe("Practitioner Brief");
    expect(
      sourceDisplayLabel(
        story({ kind: "native", source_name: NATIVE_SOURCE_NAME, generator_type: "cross-sector-chain-native" }),
      ),
    ).toBe("The Connection");
    expect(
      sourceDisplayLabel(
        story({ kind: "native", source_name: NATIVE_SOURCE_NAME, generator_type: "tool-spotlight-native" }),
      ),
    ).toBe("Worth an Afternoon");
  });

  it("keeps SIGNAL for a native post with no brand mapping", () => {
    expect(
      sourceDisplayLabel(
        story({ kind: "native", source_name: NATIVE_SOURCE_NAME, generator_type: "github-trending-native" }),
      ),
    ).toBe(NATIVE_SOURCE_NAME);
  });

  it("keeps SIGNAL for a native post with a null generator_type", () => {
    expect(
      sourceDisplayLabel(
        story({ kind: "native", source_name: NATIVE_SOURCE_NAME, generator_type: null }),
      ),
    ).toBe(NATIVE_SOURCE_NAME);
  });

  it("returns the source name for an ingested story", () => {
    expect(sourceDisplayLabel(story({ source_name: "OutletA" }))).toBe("OutletA");
  });

  it("ignores generator_type when the story is not native", () => {
    // Defensive: an ingested story never adopts a brand label even if a
    // stray generator_type rides along on the wire.
    expect(
      sourceDisplayLabel(
        story({ kind: "ingested", source_name: "OutletA", generator_type: "arxiv-synthesis-native" }),
      ),
    ).toBe("OutletA");
  });

  it("falls back to the primary source name when source_name is null", () => {
    expect(
      sourceDisplayLabel(
        story({
          kind: "native",
          source_name: null,
          generator_type: "arxiv-synthesis-native",
          sources: [{ url: "u", name: NATIVE_SOURCE_NAME, role: "primary" }],
        }),
      ),
    ).toBe("The Research Read");
  });
});

describe("brandLabelForGeneratorType", () => {
  it("maps known slugs to their brand labels", () => {
    expect(brandLabelForGeneratorType("arxiv-synthesis-native")).toBe(
      "The Research Read",
    );
    expect(brandLabelForGeneratorType("hn-synthesis-native")).toBe(
      "Practitioner Brief",
    );
    expect(brandLabelForGeneratorType("cross-sector-chain-native")).toBe(
      "The Connection",
    );
    expect(brandLabelForGeneratorType("tool-spotlight-native")).toBe(
      "Worth an Afternoon",
    );
  });

  it("falls back to SIGNAL for an unrecognised native slug", () => {
    expect(brandLabelForGeneratorType("github-trending-native")).toBe(
      NATIVE_SOURCE_NAME,
    );
  });

  it("returns null for null", () => {
    expect(brandLabelForGeneratorType(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(brandLabelForGeneratorType(undefined)).toBeNull();
  });
});

describe("splitHook", () => {
  it("falls back to the headline when generic is null", () => {
    expect(splitHook(null, "Fallback headline")).toEqual({
      hookTitle: "Fallback headline",
      commentaryBody: null,
    });
  });

  it("falls back to the headline when generic is empty/whitespace", () => {
    expect(splitHook("   ", "Fallback headline")).toEqual({
      hookTitle: "Fallback headline",
      commentaryBody: null,
    });
  });

  it("returns the whole text (period stripped) for a single sentence", () => {
    expect(splitHook("This is the only sentence.", "fallback")).toEqual({
      hookTitle: "This is the only sentence",
      commentaryBody: null,
    });
  });

  it("splits a multi-sentence string at the first sentence boundary", () => {
    const { hookTitle, commentaryBody } = splitHook(
      "Nvidia blew past estimates. The data-center segment doubled. Margins held.",
      "fallback",
    );
    expect(hookTitle).toBe("Nvidia blew past estimates");
    expect(commentaryBody).toBe("The data-center segment doubled. Margins held.");
  });

  it("splits on an em-dash clause break, excluding the dash", () => {
    const { hookTitle, commentaryBody } = splitHook(
      "Apple's services pivot is working — the revenue mix shifted hard.",
      "fallback",
    );
    expect(hookTitle).toBe("Apple's services pivot is working");
    expect(commentaryBody).toBe("the revenue mix shifted hard.");
  });

  it("keeps an exclamation / question mark on the hook title", () => {
    expect(splitHook("Huge news today! Here is why it matters.", "fallback")).toEqual(
      { hookTitle: "Huge news today!", commentaryBody: "Here is why it matters." },
    );
  });

  it("does not split on a period that is not a sentence boundary", () => {
    // "U.S." has no following capital-after-space at the dot, so the first
    // real boundary is after "markets".
    const { hookTitle } = splitHook(
      "The U.S. moved markets. More follows.",
      "fallback",
    );
    expect(hookTitle).toBe("The U.S. moved markets");
  });
});
