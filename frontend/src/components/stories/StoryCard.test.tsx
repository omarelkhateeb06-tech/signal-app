import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
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

describe("StoryCard og:image thumbnail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the thumbnail when story.image_url is non-null", () => {
    const { container } = renderCard(
      baseStory({ image_url: "https://cdn.example.com/og.jpg" }),
    );
    // Use querySelector — the thumbnail is decorative (alt=""), so it
    // has no "img" ARIA role and getByRole("img") wouldn't find it.
    const img = container.querySelector("img[src=\"https://cdn.example.com/og.jpg\"]");
    expect(img).not.toBeNull();
  });

  it("does not render any img element when story.image_url is null", () => {
    const { container } = renderCard(baseStory({ image_url: null }));
    // The card has no other <img> elements when image_url is null —
    // the SaveButton uses lucide-react SVGs, not raster images, and
    // the SectorBadge is text.
    const imgs = container.querySelectorAll("img");
    expect(imgs.length).toBe(0);
  });
});
