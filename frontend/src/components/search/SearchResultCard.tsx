import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { SectorBadge } from "@/components/stories/SectorBadge";
import { StorySaveButton } from "@/components/stories/StorySaveButton";
import { Card, type CardSectorAccent } from "@/components/ui/Card";
import { highlightText } from "@/lib/highlight";
import { timeAgo } from "@/lib/timeAgo";
import type { SearchResultStory } from "@/types/story";

// Phase 12j — search-result card. Mirrors StoryCard's shape (sector
// left-border, serif headline in --ink with --accent on hover via
// group-hover, sector badge + mono timestamp + comments). Diverges
// in two places: text uses highlightText for the matched query
// terms, and there is no commentary lazy fetch — the search payload
// already carries the context snippet.

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
  index = 0,
}: SearchResultCardProps): JSX.Element {
  const stamp = timeAgo(story.published_at ?? story.created_at);
  const staggerDelay = index < 10 ? `${index * 30}ms` : "0ms";

  return (
    <Card
      interactive
      sectorAccent={sectorAccentFor(story.sector)}
      className="animate-fade-up p-6"
      style={{ animationDelay: staggerDelay }}
    >
      <Link
        href={`/stories/${story.id}`}
        className="group block hover:no-underline"
      >
        <h2 className="mb-2 font-display text-lg font-semibold leading-snug text-ink transition-colors duration-150 group-hover:text-accent">
          {highlightText(story.headline, terms)}
        </h2>
        <p
          className="mb-4 text-sm leading-relaxed text-ink-muted"
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
