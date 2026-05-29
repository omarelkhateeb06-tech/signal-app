"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { useReadStoriesStore } from "@/store/readStoriesStore";
import { timeAgo } from "@/lib/timeAgo";
import type { Story } from "@/types/story";

// Secondary "top stories" rail item. Deliberately dense and text-only:
// sector kicker + source dateline, a tight serif headline (2 lines),
// and a mono meta line. No imagery, no commentary body — the rail is
// for fast triage of the next-most-important stories beside the lead.

const EASE: [number, number, number, number] = [0.2, 0.8, 0.2, 1];

export const railItemVariants = {
  hidden: { opacity: 0, y: 10 },
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
  semiconductors: "Semis",
};

export function FeedRailItem({
  story,
  rank,
  animated = false,
}: {
  story: Story;
  rank?: number;
  animated?: boolean;
}): JSX.Element {
  const stamp = timeAgo(story.published_at ?? story.created_at);
  const isRead = useReadStoriesStore((s) => s.isRead(story.id));
  const sectorColor = SECTOR_VAR[story.sector] ?? "var(--ink-muted)";
  const source = story.source_name ?? story.sources[0]?.name ?? null;

  return (
    <motion.div variants={animated ? railItemVariants : undefined}>
      <Link
        href={`/stories/${story.id}`}
        className="group block py-4 hover:no-underline"
      >
        <div className="mb-1.5 flex items-center gap-2">
          {rank != null && (
            <span className="font-mono text-[10px] font-semibold tabular-nums tracking-[0.1em] text-ink-muted">
              {String(rank).padStart(2, "0")}
            </span>
          )}
          <span
            className="font-mono text-[10px] font-medium uppercase tracking-[0.14em]"
            style={{ color: sectorColor }}
          >
            {SECTOR_SHORT[story.sector] ?? story.sector}
          </span>
          {source && (
            <span className="truncate font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted">
              · {source}
            </span>
          )}
        </div>
        <h3
          className={[
            "font-display text-[18px] font-semibold leading-snug transition-colors duration-150",
            isRead ? "text-ink-muted" : "text-ink group-hover:text-accent",
          ].join(" ")}
          style={{
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {story.headline}
        </h3>
        <div className="mt-2 flex items-center gap-3 text-ink-muted">
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
        </div>
      </Link>
    </motion.div>
  );
}
