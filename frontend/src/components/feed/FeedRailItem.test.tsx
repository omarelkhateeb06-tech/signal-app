import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Story } from "@/types/story";
import { FeedRailItem } from "./FeedRailItem";

function baseStory(overrides: Partial<Story> = {}): Story {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    sector: "ai",
    headline: "Source wire headline",
    context: "",
    why_it_matters: "",
    gated: false,
    why_it_matters_to_you: "The hook that should headline.",
    commentary: null,
    commentary_source: null,
    generic_commentary: null,
    generator_type: null,
    source_url: "https://example.com/a",
    source_name: "OutletA",
    primary_source_url: "https://example.com/a",
    sources: [{ url: "https://example.com/a", name: "OutletA", role: "primary" }],
    image_url: null,
    published_at: "2026-05-10T00:00:00Z",
    created_at: "2026-05-10T00:00:00Z",
    author: null,
    is_saved: false,
    save_count: 0,
    comment_count: 0,
    reading_time_minutes: 4,
    ...overrides,
  };
}

describe("FeedRailItem hook-as-title", () => {
  // The rail is compact: hook title (first sentence of generic_commentary)
  // as the H3, source headline demoted to a muted attribution line, and NO
  // commentary body (too dense for the secondary rail).
  it("promotes the hook title and demotes the source headline", () => {
    render(
      <FeedRailItem
        story={baseStory({
          headline: "Source wire headline",
          generic_commentary:
            "The hook that should headline. Body text the rail omits.",
        })}
        rank={2}
      />,
    );
    // Hook title (first sentence, trailing period stripped) is the H3.
    expect(
      screen.getByText("The hook that should headline"),
    ).toBeInTheDocument();
    // Source headline survives as a muted attribution line.
    expect(screen.getByText("Source wire headline")).toBeInTheDocument();
    // The commentary body is omitted on the rail.
    expect(
      screen.queryByText("Body text the rail omits."),
    ).not.toBeInTheDocument();
  });

  it("leaves native (SIGNAL) items on their editorial headline", () => {
    render(
      <FeedRailItem
        story={baseStory({
          source_name: "SIGNAL",
          sources: [{ url: "https://signal.so", name: "SIGNAL", role: "primary" }],
          headline: "Editorial native headline",
          generic_commentary: "Native hook that must not headline. And a body.",
        })}
        rank={3}
      />,
    );
    expect(screen.getByText("Editorial native headline")).toBeInTheDocument();
    expect(
      screen.queryByText("Native hook that must not headline"),
    ).not.toBeInTheDocument();
  });
});

describe("FeedRailItem branded labels + comment count", () => {
  it("brands the source kicker for a mapped native generator", () => {
    render(
      <FeedRailItem
        story={baseStory({
          source_name: "SIGNAL",
          sources: [{ url: "https://signal.so", name: "SIGNAL", role: "primary" }],
          generator_type: "cross-sector-chain-native",
        })}
        rank={2}
      />,
    );
    expect(screen.getByText("· The Connection")).toBeInTheDocument();
  });

  it("keeps the SIGNAL byline for an unmapped native generator", () => {
    render(
      <FeedRailItem
        story={baseStory({
          source_name: "SIGNAL",
          sources: [{ url: "https://signal.so", name: "SIGNAL", role: "primary" }],
          generator_type: "github-trending-native",
        })}
        rank={2}
      />,
    );
    expect(screen.getByText("· SIGNAL")).toBeInTheDocument();
  });

  it("shows the comment count when comments exist", () => {
    const { container } = render(
      <FeedRailItem story={baseStory({ comment_count: 7 })} rank={2} />,
    );
    const badge = container.querySelector(".lucide-message-square");
    expect(badge).not.toBeNull();
    expect(badge?.parentElement?.textContent).toContain("7");
  });

  it("omits the comment count when there are none", () => {
    const { container } = render(
      <FeedRailItem story={baseStory({ comment_count: 0 })} rank={2} />,
    );
    expect(container.querySelector(".lucide-message-square")).toBeNull();
  });
});
