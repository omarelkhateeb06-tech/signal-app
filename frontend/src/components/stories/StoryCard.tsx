"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { SectorBadge } from "./SectorBadge";
import { StorySaveButton } from "./StorySaveButton";
import { Card, type CardSectorAccent } from "@/components/ui/Card";
import { useStoryCommentary } from "@/hooks/useStoryCommentary";
import { timeAgo } from "@/lib/timeAgo";
import { isGatePayload, type Story } from "@/types/story";

// Phase 12c — each card self-manages when to fire its commentary
// fetch via IntersectionObserver with a rootMargin that provides
// roughly 5 cards of lookahead. Coupled with COMMENTARY_MAX_CONCURRENT
// in lib/commentaryQueue, this produces:
//   - first page: ~first 5-8 cards above-the-fold trigger immediately,
//     saturating the 8-slot semaphore; the remaining 2-5 queue and
//     resolve as soon as the first wave returns.
//   - scrolling: newly-visible cards (and ~5 more below them) flip
//     to enabled; queue absorbs the spike.
const VISIBILITY_ROOT_MARGIN = "1200px 0px";

interface StoryCardProps {
  story: Story;
  // Phase 12j — stagger entrance animation. Cards are mounted at the
  // same time on a fresh feed load; we want them to fade in with a
  // small per-card delay so the eye reads them sequentially. Passed
  // by the feed page based on within-page index.
  index?: number;
}

function sectorAccentFor(sector: string): CardSectorAccent {
  if (sector === "ai") return "ai";
  if (sector === "finance") return "finance";
  if (sector === "semiconductors") return "semis";
  return null;
}

function primaryParagraph(text: string): string {
  // The commentary thesis can be a paragraph or two; on the feed we
  // show the first paragraph as a preview, line-clamped to ~3 lines
  // via CSS. Pre-trim on the input to avoid trailing whitespace
  // confusing the clamp.
  return text.trim();
}

export function StoryCard({ story, index = 0 }: StoryCardProps): JSX.Element {
  const stamp = timeAgo(story.published_at ?? story.created_at);

  const [shouldLoad, setShouldLoad] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = cardRef.current;
    if (!el || shouldLoad) return;
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

  const apiCommentary =
    commentaryQuery.data && !isGatePayload(commentaryQuery.data)
      ? commentaryQuery.data.commentary
      : null;
  const resolvedCommentary = apiCommentary ?? story.commentary ?? null;
  const isCommentaryLoading =
    shouldLoad && resolvedCommentary === null && commentaryQuery.isFetching;

  // 12j — feed preview shows the commentary thesis when we have one,
  // or the why_it_matters_to_you template body as the fallback. The
  // tail of the card always has the sector badge + timestamp; the
  // source attribution moves to a small subtitle directly under the
  // headline (per the brief: "via Bloomberg" / "via SemiAnalysis,
  // Bloomberg, +3 more").
  const previewText = resolvedCommentary?.thesis ?? story.why_it_matters_to_you;
  const sourceCount = story.sources.length;
  const primarySource = story.source_name ?? story.sources[0]?.name ?? null;
  const sourceLabel =
    sourceCount > 1 && primarySource
      ? `via ${primarySource}, +${sourceCount - 1} more`
      : primarySource
        ? `via ${primarySource}`
        : null;

  // Stagger only the first ~10 cards so later scroll-loads don't get
  // a perceptible delay before they paint.
  const staggerDelay = index < 10 ? `${index * 40}ms` : "0ms";

  return (
    <Card
      ref={cardRef}
      interactive
      sectorAccent={sectorAccentFor(story.sector)}
      className="animate-fade-up p-6"
      style={{ animationDelay: staggerDelay }}
    >
      <Link href={`/stories/${story.id}`} className="group block hover:no-underline">
        {/* Phase 12k — right-aligned supplemental thumbnail. The headline +
            commentary stay primary; thumbnail is rendered to the right at
            a fixed compact size. When story.image_url is null, no slot is
            reserved (the card lays out exactly as it did pre-12k). */}
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <h2 className="mb-1 font-display text-[20px] font-semibold leading-snug text-ink transition-colors duration-150 group-hover:text-accent">
              {story.headline}
            </h2>
            {sourceLabel && (
              <p className="mb-3 text-xs text-ink-muted">{sourceLabel}</p>
            )}
            <p
              className="mb-4 text-sm leading-relaxed text-ink-muted"
              style={{
                display: "-webkit-box",
                WebkitLineClamp: 3,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {isCommentaryLoading
                ? "Generating your briefing…"
                : primaryParagraph(previewText)}
            </p>
          </div>
          {story.image_url && (
            <Image
              src={story.image_url}
              alt=""
              width={120}
              height={80}
              unoptimized
              loading="lazy"
              className="flex-none rounded-md object-cover"
              style={{ width: 120, height: 80 }}
            />
          )}
        </div>
      </Link>

      <div className="flex items-center justify-between gap-3 text-xs text-ink-muted">
        <div className="flex items-center gap-3">
          <SectorBadge sector={story.sector} />
          {stamp && (
            <span className="font-mono text-[11px] tracking-tight">{stamp}</span>
          )}
          {story.comment_count > 0 && (
            <span className="inline-flex items-center gap-1">
              <MessageSquare className="h-3.5 w-3.5" />
              {story.comment_count}
            </span>
          )}
        </div>
        <StorySaveButton story={story} />
      </div>
    </Card>
  );
}
