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
  it("promotes the hook to the headline and demotes the source headline", () => {
    render(<FeedRailItem story={baseStory()} rank={2} />);
    expect(
      screen.getByText("The hook that should headline."),
    ).toBeInTheDocument();
    expect(screen.getByText("Source wire headline")).toBeInTheDocument();
  });

  it("leaves native (SIGNAL) items on their editorial headline", () => {
    render(
      <FeedRailItem
        story={baseStory({
          source_name: "SIGNAL",
          sources: [{ url: "https://signal.so", name: "SIGNAL", role: "primary" }],
          headline: "Editorial native headline",
          why_it_matters_to_you: "Native commentary that must not headline.",
        })}
        rank={3}
      />,
    );
    expect(screen.getByText("Editorial native headline")).toBeInTheDocument();
    expect(
      screen.queryByText("Native commentary that must not headline."),
    ).not.toBeInTheDocument();
  });
});
