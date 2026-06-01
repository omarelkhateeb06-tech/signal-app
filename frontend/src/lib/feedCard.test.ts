import { describe, expect, it } from "vitest";

import type { Story } from "@/types/story";
import {
  NATIVE_SOURCE_NAME,
  isNativeStory,
  resolveCardHeadline,
} from "./feedCard";

function story(overrides: Partial<Story> = {}): Story {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    sector: "ai",
    headline: "Source article headline",
    context: "",
    why_it_matters: "",
    gated: false,
    why_it_matters_to_you: "",
    commentary: null,
    commentary_source: null,
    source_url: "https://example.com/a",
    source_name: "OutletA",
    primary_source_url: "https://example.com/a",
    sources: [{ url: "https://example.com/a", name: "OutletA", role: "primary" }],
    image_url: null,
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
  it("is true when source_name is the native display name", () => {
    expect(isNativeStory(story({ source_name: NATIVE_SOURCE_NAME }))).toBe(true);
  });

  it("falls back to the primary source name when source_name is null", () => {
    expect(
      isNativeStory(
        story({
          source_name: null,
          sources: [{ url: "u", name: NATIVE_SOURCE_NAME, role: "primary" }],
        }),
      ),
    ).toBe(true);
  });

  it("is false for an ordinary ingested outlet", () => {
    expect(isNativeStory(story({ source_name: "OutletA" }))).toBe(false);
  });
});

describe("resolveCardHeadline", () => {
  it("swaps hook to primary and source headline to attribution for ingested", () => {
    const result = resolveCardHeadline(story(), "The hook that matters.");
    expect(result.primary).toBe("The hook that matters.");
    expect(result.attribution).toBe("Source article headline");
  });

  it("keeps the source headline primary for native (no swap)", () => {
    const result = resolveCardHeadline(
      story({ source_name: NATIVE_SOURCE_NAME }),
      "A hook that should be ignored.",
    );
    expect(result.primary).toBe("Source article headline");
    expect(result.attribution).toBeNull();
  });

  it("falls back to the source headline when the hook is empty", () => {
    const result = resolveCardHeadline(story(), "   ");
    expect(result.primary).toBe("Source article headline");
    expect(result.attribution).toBeNull();
  });

  it("falls back to the source headline when the hook is null", () => {
    const result = resolveCardHeadline(story(), null);
    expect(result.primary).toBe("Source article headline");
    expect(result.attribution).toBeNull();
  });
});
