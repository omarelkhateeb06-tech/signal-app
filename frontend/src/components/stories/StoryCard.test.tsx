import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Story } from "@/types/story";

// Phase 12k — the card lazy-loads commentary via IntersectionObserver.
// In jsdom that observer isn't available, so the hook never fires the
// effect that depends on `shouldLoad`. Mock the hook to a stable idle
// state so the render path is deterministic — we're testing the
// thumbnail slot, not the commentary pipeline.
vi.mock("@/hooks/useStoryCommentary", () => ({
  useStoryCommentary: () => ({
    data: undefined,
    isFetching: false,
    isLoading: false,
  }),
}));

vi.mock("@/hooks/useStorySave", () => ({
  useStorySave: () => ({
    isSaved: false,
    toggleSave: vi.fn(),
    isLoading: false,
  }),
}));

vi.mock("next/image", () => ({
  default: (
    props: React.ImgHTMLAttributes<HTMLImageElement> & {
      src: string;
      alt: string;
    },
  ) => {
    // next/image renders an <img> under the hood with the same src/alt;
    // stubbing it directly keeps the assertions on real DOM nodes
    // without dragging Next's runtime image optimizer into jsdom.
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...props} />;
  },
}));

import { StoryCard } from "./StoryCard";

function baseStory(overrides: Partial<Story> = {}): Story {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    sector: "ai",
    headline: "Test headline",
    context: "Test context",
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
    ...overrides,
  };
}

function renderCard(story: Story): { container: HTMLElement } {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<StoryCard story={story} />, { wrapper: Wrapper });
}

describe("StoryCard imagery (text-forward river card)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Editorial redesign: the river card is deliberately text-forward —
  // imagery is reserved for the feed lead (FeedLead) so the river reads
  // as a dense, scannable column. The card therefore renders NO <img>
  // regardless of whether the story carries an og:image.
  it("does not render a thumbnail even when story.image_url is set", () => {
    const { container } = renderCard(
      baseStory({ image_url: "https://cdn.example.com/og.jpg" }),
    );
    const imgs = container.querySelectorAll("img");
    expect(imgs.length).toBe(0);
  });

  it("renders no img element when story.image_url is null", () => {
    const { container } = renderCard(baseStory({ image_url: null }));
    const imgs = container.querySelectorAll("img");
    expect(imgs.length).toBe(0);
  });
});

describe("StoryCard three-section model", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Ingested cards build three sections from generic_commentary: the hook
  // title (first sentence) as the headline, the source headline as muted
  // attribution, and the remainder as the commentary body.
  it("splits generic_commentary into hook title + attribution + body", () => {
    renderCard(
      baseStory({
        headline: "Source wire headline",
        generic_commentary:
          "The hook that leads the card. Plus the body that follows it.",
      }),
    );
    expect(screen.getByText("The hook that leads the card")).toBeInTheDocument();
    expect(screen.getByText("Source wire headline")).toBeInTheDocument();
    expect(
      screen.getByText("Plus the body that follows it."),
    ).toBeInTheDocument();
  });

  // Native (SIGNAL) cards keep the classic headline-then-commentary layout,
  // untouched by the split even though they carry generic_commentary.
  it("leaves native (SIGNAL) cards on their editorial headline", () => {
    renderCard(
      baseStory({
        source_name: "SIGNAL",
        sources: [{ url: "https://signal.so", name: "SIGNAL", role: "primary" }],
        headline: "Editorial native headline",
        generic_commentary: "Native hook that must not headline. And a body.",
      }),
    );
    expect(screen.getByText("Editorial native headline")).toBeInTheDocument();
    expect(
      screen.queryByText("Native hook that must not headline"),
    ).not.toBeInTheDocument();
  });
});

describe("StoryCard branded labels + comment count", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("brands the source kicker for a mapped native generator", () => {
    renderCard(
      baseStory({
        source_name: "SIGNAL",
        sources: [{ url: "https://signal.so", name: "SIGNAL", role: "primary" }],
        generator_type: "hn-synthesis-native",
      }),
    );
    expect(screen.getByText(/Practitioner Brief/)).toBeInTheDocument();
  });

  it("keeps the SIGNAL byline for an unmapped native generator", () => {
    renderCard(
      baseStory({
        source_name: "SIGNAL",
        sources: [{ url: "https://signal.so", name: "SIGNAL", role: "primary" }],
        generator_type: "github-trending-native",
      }),
    );
    expect(screen.getByText(/SIGNAL/)).toBeInTheDocument();
  });

  it("shows the comment count when comments exist", () => {
    const { container } = renderCard(baseStory({ comment_count: 9 }));
    const badge = container.querySelector(".lucide-message-square");
    expect(badge).not.toBeNull();
    expect(badge?.parentElement?.textContent).toContain("9");
  });

  it("omits the comment count when there are none", () => {
    const { container } = renderCard(baseStory({ comment_count: 0 }));
    expect(container.querySelector(".lucide-message-square")).toBeNull();
  });
});
