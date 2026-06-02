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
    generic_commentary: null,
    generator_type: null,
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

  // Three-section model: for ingested stories the hook title (first
  // sentence of generic_commentary) is the headline, the source article
  // headline drops to a muted attribution line, and the commentary body
  // (the remainder of generic_commentary) renders as its own paragraph.
  // The old "Why it matters to you" label is gone for ingested rows.
  it("splits generic_commentary into hook title + attribution + body", () => {
    renderLead(
      baseStory({
        headline: "Source wire headline",
        generic_commentary:
          "This is the hook that should headline. And here is why it matters.",
      }),
    );
    // Section 1 — hook title (first sentence, trailing period stripped).
    expect(
      screen.getByText("This is the hook that should headline"),
    ).toBeInTheDocument();
    // Section 2 — source headline demoted to muted attribution.
    expect(screen.getByText("Source wire headline")).toBeInTheDocument();
    // Section 3 — commentary body (the remainder).
    expect(screen.getByText("And here is why it matters.")).toBeInTheDocument();
    expect(screen.queryByText("Why it matters to you")).not.toBeInTheDocument();
  });

  // Native (SIGNAL) stories keep the classic headline + framed commentary,
  // untouched by the three-section split even though they also carry
  // generic_commentary on the wire.
  it("leaves native (SIGNAL) stories untouched", () => {
    renderLead(
      baseStory({
        source_name: "SIGNAL",
        sources: [{ url: "https://signal.so", name: "SIGNAL", role: "primary" }],
        headline: "Editorial native headline",
        why_it_matters_to_you: "Native commentary body.",
        generic_commentary: "Native hook. Native body that must not split.",
      }),
    );
    expect(screen.getByText("Editorial native headline")).toBeInTheDocument();
    expect(screen.getByText("Why it matters to you")).toBeInTheDocument();
    expect(screen.getByText("Native commentary body.")).toBeInTheDocument();
    // The generic_commentary hook must NOT appear — native is exempt.
    expect(screen.queryByText("Native hook")).not.toBeInTheDocument();
  });

  // Branded section labels: a native post's source kicker shows the
  // generator's brand name instead of the shared "SIGNAL" byline.
  it("brands the kicker for a mapped native generator", () => {
    renderLead(
      baseStory({
        source_name: "SIGNAL",
        sources: [{ url: "https://signal.so", name: "SIGNAL", role: "primary" }],
        generator_type: "arxiv-synthesis-native",
      }),
    );
    expect(screen.getByText("via The Research Read")).toBeInTheDocument();
    expect(screen.queryByText("via SIGNAL")).not.toBeInTheDocument();
  });

  it("keeps the SIGNAL byline for an unmapped native generator", () => {
    renderLead(
      baseStory({
        source_name: "SIGNAL",
        sources: [{ url: "https://signal.so", name: "SIGNAL", role: "primary" }],
        generator_type: "github-trending-native",
      }),
    );
    expect(screen.getByText("via SIGNAL")).toBeInTheDocument();
  });

  it("shows the comment count when comments exist", () => {
    const { container } = renderLead(baseStory({ comment_count: 12 }));
    const badge = container.querySelector(".lucide-message-square");
    expect(badge).not.toBeNull();
    expect(badge?.parentElement?.textContent).toContain("12");
  });

  it("omits the comment count when there are none", () => {
    const { container } = renderLead(baseStory({ comment_count: 0 }));
    expect(container.querySelector(".lucide-message-square")).toBeNull();
  });
});
