"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { motion } from "framer-motion";
import { StorySaveButton } from "./StorySaveButton";
import { Card, type CardSectorAccent } from "@/components/ui/Card";
import { useStoryCommentary } from "@/hooks/useStoryCommentary";
import { useReadStoriesStore } from "@/store/readStoriesStore";
import { timeAgo } from "@/lib/timeAgo";
import { isGatePayload, type Story } from "@/types/story";

const VISIBILITY_ROOT_MARGIN = "1200px 0px";
const EASE: [number, number, number, number] = [0.2, 0.8, 0.2, 1];

export const storyCardVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.32, ease: EASE } },
};

const SECTOR_VAR: Record<string, string> = {
  ai: "var(--ai)",
  finance: "var(--finance)",
  semiconductors: "var(--semis)",
};

const SECTOR_SHORT: Record<string, string> = {
  ai: "AI",
  finance: "Finance",
  semiconductors: "Semiconductors",
};

interface StoryCardProps {
  story: Story;
  index?: number;
  animated?: boolean;
}

function sectorAccentFor(sector: string): CardSectorAccent {
  if (sector === "ai") return "ai";
  if (sector === "finance") return "finance";
  if (sector === "semiconductors") return "semis";
  return null;
}

export function StoryCard({
  story,
  index = 0,
  animated = false,
}: StoryCardProps): JSX.Element {
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

  const previewText = resolvedCommentary?.thesis ?? story.why_it_matters_to_you;
  const sourceCount = story.sources.length;
  const primarySource = story.source_name ?? story.sources[0]?.name ?? null;
  const sourceLabel =
    sourceCount > 1 ? `+${sourceCount - 1}` : null;

  const isRead = useReadStoriesStore((s) => s.isRead(story.id));
  const sectorColor = SECTOR_VAR[story.sector] ?? "var(--ink-muted)";

  void index;

  return (
    <motion.div
      variants={animated ? storyCardVariants : undefined}
      whileHover={{ y: -2, transition: { duration: 0.15, ease: EASE } }}
      className="h-full"
    >
      <Card
        ref={cardRef}
        sectorAccent={sectorAccentFor(story.sector)}
        className="flex h-full flex-col p-5"
      >
        <Link
          href={`/stories/${story.id}`}
          className="group flex flex-1 flex-col hover:no-underline"
        >
          {/* Sector kicker — unified editorial dateline language */}
          <div className="mb-2 flex items-center gap-2">
            <span
              className="inline-flex items-center gap-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em]"
              style={{ color: sectorColor }}
            >
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: sectorColor }}
              />
              {SECTOR_SHORT[story.sector] ?? story.sector}
            </span>
            {primarySource && (
              <span className="truncate font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted">
                · {primarySource}
                {sourceLabel ? ` ${sourceLabel}` : ""}
              </span>
            )}
          </div>

          <h2
            className={[
              "mb-2 font-display text-[19px] font-semibold leading-snug transition-colors duration-150 group-hover:text-accent",
              isRead ? "text-ink-muted" : "text-ink",
            ].join(" ")}
          >
            {story.headline}
          </h2>

          <p
            className="text-sm leading-relaxed text-ink-muted"
            style={{
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {isCommentaryLoading ? "Generating your briefing…" : previewText}
          </p>
        </Link>

        <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-3 text-xs text-ink-muted">
          <div className="flex items-center gap-3">
            {stamp && (
              <span className="font-mono text-[10px] uppercase tracking-wide">
                {stamp}
              </span>
            )}
            {story.reading_time_minutes != null && (
              <span className="font-mono text-[10px] uppercase tracking-wide">
                {story.reading_time_minutes} min
              </span>
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
    </motion.div>
  );
}
