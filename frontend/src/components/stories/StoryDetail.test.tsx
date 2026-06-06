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
    generic_commentary: null,
    generator_type: null,
    source_url: "https://example.com/article",
    source_name: "Example",
    primary_source_url: "https://example.com/article",
    sources: [
      { url: "https://example.com/article", name: "Example", role: "primary" },
    ],
    image_url: null,
    illustration_url: null,
    content_type: null,
    published_at: "2026-05-10T00:00:00Z",
    created_at: "2026-05-10T00:00:00Z",
    author: null,
    is_saved: false,
    save_count: 0,
    comment_count: 0,
    // Tests predate the explicit `kind` field; derive it from the source
    // name so existing native fixtures (source_name "SIGNAL") stay native.
    kind:
      overrides.source_name === "SIGNAL" ||
      overrides.sources?.some((s) => s.name === "SIGNAL")
        ? "native"
        : "ingested",
    ...overrides,
  };
}

function renderDetail(story: Story) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<StoryDetail story={story} />, { wrapper: Wrapper });
}

// Phase 12r — native story fixture. source_name "SIGNAL" makes
// isNativeStory() return true; generator_type drives the brand label.
function nativeStory(overrides: Partial<Story> = {}): Story {
  return baseStory({
    source_name: "SIGNAL",
    source_url: "https://signal.so",
    sources: [{ url: "https://signal.so", name: "SIGNAL", role: "primary" }],
    generator_type: "arxiv-synthesis-native",
    generic_commentary:
      "This week's synthesis covers three AI papers on transformer efficiency. The work pushes state-of-the-art on long-context reasoning.",
    context: "Weekly arXiv synthesis — 3 ai paper(s), 2026-W22",
    ...overrides,
  });
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

// Phase 12r — native post layout tests.
describe("StoryDetail native post layout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the synthesis hero (generic_commentary) for native posts", () => {
    const { getByText } = renderDetail(nativeStory());
    // The synthesis body text should appear as the hero paragraph.
    expect(
      getByText(/This week's synthesis covers three AI papers/),
    ).not.toBeNull();
  });

  it("renders the brand label without 'via' prefix for native posts", () => {
    const { getByText } = renderDetail(nativeStory());
    // Brand label text should appear (no "via" prefix).
    expect(getByText("The Research Read")).not.toBeNull();
  });

  it("does not render 'From the source' section for native posts", () => {
    const { queryByText } = renderDetail(nativeStory());
    expect(queryByText("From the source")).toBeNull();
  });

  it("does not render synthesis hero when generic_commentary is null", () => {
    const { queryByText } = renderDetail(
      nativeStory({ generic_commentary: null }),
    );
    expect(queryByText("The synthesis")).toBeNull();
  });

  it("renders 'From the source' section for ingested posts", () => {
    const { getByText } = renderDetail(baseStory());
    expect(getByText("From the source")).not.toBeNull();
  });

  it("renders 'via {source}' kicker for ingested posts", () => {
    const { getByText } = renderDetail(baseStory({ source_name: "Reuters" }));
    expect(getByText("via Reuters")).not.toBeNull();
  });

  // Phase 12s — native illustration hero.
  it("renders the illustration hero for a native post with illustration_url", () => {
    const { container } = renderDetail(
      nativeStory({ illustration_url: "https://cdn.example.com/native-hero.png" }),
    );
    const img = container.querySelector(
      'img[src="https://cdn.example.com/native-hero.png"]',
    );
    expect(img).not.toBeNull();
    // alt is sourced from the headline (decorative hero, but labelled).
    expect(img?.getAttribute("alt")).toBe("Detail headline");
  });

  it("renders no illustration hero when a native post has no illustration_url", () => {
    const { container } = renderDetail(nativeStory({ illustration_url: null }));
    expect(container.querySelectorAll("img").length).toBe(0);
  });

  it("does not render an illustration hero for an ingested post", () => {
    const { container } = renderDetail(
      baseStory({ illustration_url: "https://cdn.example.com/should-not-show.png" }),
    );
    expect(
      container.querySelector(
        'img[src="https://cdn.example.com/should-not-show.png"]',
      ),
    ).toBeNull();
  });
});
