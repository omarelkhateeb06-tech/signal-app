import Link from "next/link";
import { MessageSquare, ExternalLink } from "lucide-react";
import { SectorBadge } from "./SectorBadge";
import { StorySaveButton } from "./StorySaveButton";
import { PersonalizationBox } from "./PersonalizationBox";
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

export function StoryCard({ story }: StoryCardProps): JSX.Element {
  const date = formatDate(story.published_at ?? story.created_at);

  return (
    <article className="group rounded-lg border border-slate-200 bg-white p-6 transition-shadow hover:shadow-md">
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

      <PersonalizationBox text={story.why_it_matters_to_you} />

      <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
        <div className="flex items-center gap-4">
          {story.author?.name && <span>By {story.author.name}</span>}
          <span className="inline-flex items-center gap-1">
            <MessageSquare className="h-3.5 w-3.5" />
            {story.comment_count}
          </span>
        </div>
        {story.source_url && (
          <a
            href={story.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-slate-500 hover:text-violet-700"
          >
            {story.source_name ?? "Source"}
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </article>
  );
}
