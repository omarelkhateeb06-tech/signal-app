"use client";

import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { motion } from "framer-motion";
import { StorySaveButton } from "@/components/stories/StorySaveButton";
import { Card, type CardSectorAccent } from "@/components/ui/Card";
import { useReadStoriesStore } from "@/store/readStoriesStore";
import { highlightText } from "@/lib/highlight";
import { timeAgo } from "@/lib/timeAgo";
import type { SearchResultStory } from "@/types/story";

const EASE: [number, number, number, number] = [0.2, 0.8, 0.2, 1];

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

function sectorAccentFor(sector: string): CardSectorAccent {
  if (sector === "ai") return "ai";
  if (sector === "finance") return "finance";
  if (sector === "semiconductors") return "semis";
  return null;
}

interface SearchResultCardProps {
  story: SearchResultStory;
  terms: string[];
  index?: number;
}

export function SearchResultCard({
  story,
  terms,
}: SearchResultCardProps): JSX.Element {
  const stamp = timeAgo(story.published_at ?? story.created_at);
  const isRead = useReadStoriesStore((s) => s.isRead(story.id));
  const sectorColor = SECTOR_VAR[story.sector] ?? "var(--ink-muted)";
  const source = story.source_name ?? story.sources[0]?.name ?? null;

  return (
    <motion.div
      whileHover={{ y: -2, transition: { duration: 0.15, ease: EASE } }}
    >
      <Card sectorAccent={sectorAccentFor(story.sector)} className="p-5">
        <Link href={`/stories/${story.id}`} className="group block hover:no-underline">
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
            {source && (
              <span className="truncate font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted">
                · {source}
              </span>
            )}
          </div>

          <h2
            className={[
              "mb-2 font-display text-[19px] font-semibold leading-snug transition-colors duration-150 group-hover:text-accent",
              isRead ? "text-ink-muted" : "text-ink",
            ].join(" ")}
          >
            {highlightText(story.headline, terms)}
          </h2>
          <p
            className="text-sm leading-relaxed text-ink-muted"
            style={{
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {highlightText(story.context, terms)}
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
