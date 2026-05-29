import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Story } from "@/types/story";

// The lead hydrates commentary immediately; mock the hook to a stable
// idle state so the render path is deterministic — we're testing the
// hero imagery slot, not the commentary pipeline.
vi.mock("@/hooks/useStoryCommentary", () => ({
  useStoryCommentary: () => ({ data: undefined, isFetching: false, isLoading: false }),
}));

vi.mock("@/hooks/useStorySave", () => ({
  useStorySave: () => ({ isSaved: false, toggleSave: vi.fn(), isLoading: false }),
}));

vi.mock("next/image", () => ({
  default: (
    props: React.ImgHTMLAttributes<HTMLImageElement> & { src: string; alt: string },
  ) =>
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img {...props} />,
}));

import { FeedLead } from "./FeedLead";

function baseStory(overrides: Partial<Story> = {}): Story {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    sector: "ai",
    headline: "Lead headline",
    context: "Lead context",
    why_it_matters: "Why it matters body.",
    gated: false,
    why_it_matters_to_you: "Why it matters to you body.",
    commentary: null,
    commentary_source: null,
    source_url: "https://example.com/article",
    source_name: "Example",
    primary_source_url: "https://example.com/article",
    sources: [
      { url: "https://example.com/article", name: "Example", role: "primary" },
    ],
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

function renderLead(story: Story): { container: HTMLElement } {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<FeedLead story={story} />, { wrapper: Wrapper });
}

describe("FeedLead hero imagery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the hero image when story.image_url is set", () => {
    const { container } = renderLead(
      baseStory({ image_url: "https://cdn.example.com/og.jpg" }),
    );
    const img = container.querySelector('img[src="https://cdn.example.com/og.jpg"]');
    expect(img).not.toBeNull();
  });

  it("renders no img when story.image_url is null", () => {
    const { container } = renderLead(baseStory({ image_url: null }));
    expect(container.querySelectorAll("img").length).toBe(0);
  });

  it("surfaces the personalization framing label", () => {
    renderLead(baseStory({ why_it_matters_to_you: "A plain fallback summary." }));
    expect(screen.getByText("Why it matters to you")).toBeInTheDocument();
  });
});
