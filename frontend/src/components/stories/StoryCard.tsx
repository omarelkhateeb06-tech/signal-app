"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { MessageSquare, ExternalLink } from "lucide-react";
import { SectorBadge } from "./SectorBadge";
import { StorySaveButton } from "./StorySaveButton";
import { PersonalizationBox } from "./PersonalizationBox";
import { Commentary } from "./Commentary";
import { useStoryCommentary } from "@/hooks/useStoryCommentary";
import type { Story } from "@/types/story";

function formatDate(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

interface StoryCardProps {
  story: Story;
}

// Phase 12c — each card self-manages when to fire its commentary
// fetch via IntersectionObserver with a rootMargin that provides
// roughly 5 cards of lookahead. Coupled with COMMENTARY_MAX_CONCURRENT
// in lib/commentaryQueue, this produces:
//   - first page: ~first 5-8 cards above-the-fold trigger immediately,
//     saturating the 8-slot semaphore; the remaining 2-5 queue and
//     resolve as soon as the first wave returns.
//   - scrolling: newly-visible cards (and ~5 more below them) flip
//     to enabled; queue absorbs the spike.
//
// Card height is ~200-240px; 1200px of rootMargin ≈ 5-6 cards of
// scroll-ahead, which matches the "5-story prefetch" product spec.
// We use only vertical margin (0px horizontal) — the feed is a
// single column.
const VISIBILITY_ROOT_MARGIN = "1200px 0px";

export function StoryCard({ story }: StoryCardProps): JSX.Element {
  const date = formatDate(story.published_at ?? story.created_at);

  // Once a card has been "close enough" to the viewport to prefetch,
  // we latch that state — scrolling away must NOT cancel an in-flight
  // request (StrictMode would already double-fire; canceling would
  // waste the slot and churn TanStack Query's cache).
  const [shouldLoad, setShouldLoad] = useState(false);
  const cardRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = cardRef.current;
    if (!el || shouldLoad) return;
    // If the browser doesn't support IntersectionObserver, fall back
    // to enabling immediately. The 8-slot semaphore still caps fanout.
    if (typeof IntersectionObserver === "undefined") {
      setShouldLoad(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setShouldLoad(true);
          observer.disconnect();
        }
      },
      { rootMargin: VISIBILITY_ROOT_MARGIN },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [shouldLoad]);

  const commentaryQuery = useStoryCommentary(story.id, { enabled: shouldLoad });

  // 12d — commentary is now `{thesis, support}` from the endpoint.
  // Resolution priority (unchanged):
  //   1. freshly-loaded commentary from the endpoint
  //   2. commentary pre-loaded on the story (server-side hydration path)
  //   3. the 12b why_it_matters_to_you personalization (last-resort string)
  // (3) renders through PersonalizationBox (string-only); (1) and (2)
  // render through Commentary (structured).
  const resolvedCommentary =
    commentaryQuery.data?.commentary ?? story.commentary ?? null;
  const isCommentaryLoading =
    shouldLoad && resolvedCommentary === null && commentaryQuery.isFetching;

  return (
    <article
      ref={cardRef}
      className="group rounded-lg border border-slate-200 bg-white p-6 transition-shadow hover:shadow-md"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <SectorBadge sector={story.sector} />
          {date && <span className="text-xs text-slate-500">{date}</span>}
        </div>
        <StorySaveButton story={story} />
      </div>

      <Link href={`/stories/${story.id}`} className="block">
        <h2 className="mb-2 text-xl font-semibold leading-tight text-slate-900 group-hover:text-violet-700">
          {story.headline}
        </h2>
        <p className="mb-4 line-clamp-3 text-sm leading-relaxed text-slate-600">
          {story.context}
        </p>
      </Link>

      {resolvedCommentary ? (
        <Commentary commentary={resolvedCommentary} />
      ) : (
        <PersonalizationBox
          text={story.why_it_matters_to_you}
          loading={isCommentaryLoading}
        />
      )}

      <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
        <div className="flex items-center gap-4">
          {story.author?.name && <span>By {story.author.name}</span>}
          <span className="inline-flex items-center gap-1">
            <MessageSquare className="h-3.5 w-3.5" />
            {story.comment_count}
          </span>
        </div>
        {story.source_url && (
          <div className="inline-flex items-center gap-1">
            <a
              href={story.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-slate-500 hover:text-violet-700"
            >
              {story.source_name ?? "Source"}
              <ExternalLink className="h-3 w-3" />
            </a>
            {story.sources.length > 1 && (
              <span className="text-slate-400">
                +{story.sources.length - 1} more
              </span>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
