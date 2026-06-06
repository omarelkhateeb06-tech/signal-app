"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { getNativeStoriesRequest } from "@/lib/api";
import { isConnectionStory } from "@/lib/feedCardType";
import type { NativeArchiveItem, Story } from "@/types/story";
import { ConnectionHero } from "./ConnectionHero";
import { StoryExhibit } from "./StoryExhibit";

// "SIGNAL Originals" — the native editorial posts (cross-sector chains,
// research reads, practitioner briefs, tool spotlights) surfaced as their own
// celebrated band at the top of the briefing. This is the product's
// differentiated content; the cross-sector "THE CONNECTION" chain in
// particular is the thing no aggregator produces.
//
// Redesign v2: the band now reuses the feed's card system — the flagship THE
// CONNECTION renders as the full-width illustrated hero, the rest as
// type-distinct rows (research read, practitioner brief, …) leading with the
// explanation — instead of the old uniform 2-line list. Sourced from the
// native archive endpoint (shows regardless of feed ranking); selecting an
// original opens its full read.

const ORIGINALS_LIMIT = 6;

// Adapt the lean native-archive item onto the full Story shape the shared
// card components consume. Native posts carry no external sources, so the
// breadth-derived treatments (cluster wall, source attribution) stay inert;
// `kind: "native"` routes deriveCardType through the generator-slug map.
function nativeToStory(item: NativeArchiveItem): Story {
  return {
    id: item.id,
    sector: item.sector,
    headline: item.headline,
    context: "",
    why_it_matters: item.generic_commentary ?? "",
    gated: false,
    kind: "native",
    why_it_matters_to_you: "",
    commentary: null,
    commentary_source: null,
    generic_commentary: item.generic_commentary,
    generator_type: item.generator_type,
    source_url: "",
    source_name: "SIGNAL",
    primary_source_url: null,
    sources: [],
    image_url: item.image_url,
    illustration_url: item.illustration_url,
    content_type: null,
    published_at: item.published_at,
    created_at: item.created_at,
    author: null,
    is_saved: false,
    save_count: 0,
    comment_count: 0,
  };
}

export function SignalOriginals(): JSX.Element | null {
  const router = useRouter();
  const { data } = useQuery({
    queryKey: ["native-originals", ORIGINALS_LIMIT],
    queryFn: () => getNativeStoriesRequest({ limit: ORIGINALS_LIMIT }),
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1,
  });

  // Client clock for freshness badges — null until mounted (SSR-safe).
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    setNowMs(Date.now());
  }, []);

  const items = data?.items ?? [];
  if (items.length === 0) return null;

  const stories = items.map(nativeToStory);
  const open = (id: string): void => router.push(`/stories/${id}`);

  // Promote the flagship cross-sector chain to the illustrated hero; the rest
  // render as type-distinct rows below it (their original order preserved).
  const heroIdx = stories.findIndex((s) => isConnectionStory(s));
  const hero = heroIdx >= 0 ? stories[heroIdx] : null;

  return (
    <section className="border-b border-line bg-accent/[0.03] px-6 py-6 md:px-8">
      <div className="mb-4 flex items-center gap-2">
        <span aria-hidden className="h-1.5 w-1.5 flex-none bg-accent" />
        <h2 className="font-mono text-[12px] font-semibold uppercase tracking-[0.2em] text-ink">
          Signal Originals
        </h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">
          written by SIGNAL
        </span>
      </div>

      {hero && (
        <ConnectionHero story={hero} rank={1} isActive={false} onSelect={open} />
      )}

      <div>
        {stories.map((story, i) => {
          if (i === heroIdx) return null;
          return (
            <StoryExhibit
              key={story.id}
              story={story}
              rank={i + 1}
              isActive={false}
              onSelect={open}
              nowMs={nowMs}
            />
          );
        })}
      </div>
    </section>
  );
}
