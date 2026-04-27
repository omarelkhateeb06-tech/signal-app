import Link from "next/link";
import { Bookmark, ExternalLink, MessageSquare } from "lucide-react";
import { SectorBadge } from "@/components/stories/SectorBadge";
import type { TeamFeedStory } from "@/types/team";

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

interface TeamStoryCardProps {
  story: TeamFeedStory;
  teamId: string;
}

export function TeamStoryCard({ story, teamId }: TeamStoryCardProps): JSX.Element {
  const date = formatDate(story.published_at ?? story.created_at);

  return (
    <article className="group rounded-lg border border-slate-200 bg-white p-6 transition-shadow hover:shadow-md">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <SectorBadge sector={story.sector} />
          {date && <span className="text-xs text-slate-500">{date}</span>}
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1" title="Saves by team members">
            <Bookmark className="h-3.5 w-3.5" />
            {story.save_count}
          </span>
          <span className="inline-flex items-center gap-1" title="Team comments">
            <MessageSquare className="h-3.5 w-3.5" />
            {story.team_comment_count}
          </span>
        </div>
      </div>

      <Link href={`/stories/${story.id}?team=${teamId}`} className="block">
        <h2 className="mb-2 text-xl font-semibold leading-tight text-slate-900 group-hover:text-violet-700">
          {story.headline}
        </h2>
        <p className="mb-3 line-clamp-3 text-sm leading-relaxed text-slate-600">
          {story.context}
        </p>
      </Link>

      {story.why_it_matters && (
        <p className="mb-3 rounded-md bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
          <span className="font-semibold text-slate-700">Why it matters: </span>
          {story.why_it_matters}
        </p>
      )}

      <div className="flex items-center justify-between text-xs text-slate-500">
        {story.author?.name ? <span>By {story.author.name}</span> : <span />}
        {story.source_url && (
          <a
            href={story.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 hover:text-violet-700"
          >
            {story.source_name ?? "Source"}
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </article>
  );
}
