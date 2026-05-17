import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Story } from "@/types/story";

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

vi.mock("@/hooks/useTier", () => ({
  useTier: () => ({ data: { tier: "pro", trial_available: false } }),
}));

vi.mock("next/image", () => ({
  default: (
    props: React.ImgHTMLAttributes<HTMLImageElement> & {
      src: string;
      alt: string;
    },
  ) => {
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...props} />;
  },
}));

import { StoryDetail } from "./StoryDetail";

function baseStory(overrides: Partial<Story> = {}): Story {
  return {
    id: "22222222-2222-2222-2222-222222222222",
    sector: "ai",
    headline: "Detail headline",
    context: "<p>Detail context body.</p>",
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

function renderDetail(story: Story): { container: HTMLElement } {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<StoryDetail story={story} />, { wrapper: Wrapper });
}

describe("StoryDetail og:image hero", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the hero when story.image_url is non-null", () => {
    const { container } = renderDetail(
      baseStory({ image_url: "https://cdn.example.com/hero.jpg" }),
    );
    // Decorative alt="" → no ARIA img role; query via DOM directly.
    const img = container.querySelector(
      "img[src=\"https://cdn.example.com/hero.jpg\"]",
    );
    expect(img).not.toBeNull();
  });

  it("does not render an img element when story.image_url is null", () => {
    const { container } = renderDetail(baseStory({ image_url: null }));
    // Detail has no other <img> elements when image_url is null.
    const imgs = container.querySelectorAll("img");
    expect(imgs.length).toBe(0);
  });
});
