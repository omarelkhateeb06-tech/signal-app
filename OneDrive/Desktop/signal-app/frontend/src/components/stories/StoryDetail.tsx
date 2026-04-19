import { ExternalLink, MessageSquare } from "lucide-react";
import { SectorBadge } from "./SectorBadge";
import { StorySaveButton } from "./StorySaveButton";
import { PersonalizationBox } from "./PersonalizationBox";
import type { Story } from "@/types/story";

function formatDate(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

interface StoryDetailProps {
  story: Story;
}

export function StoryDetail({ story }: StoryDetailProps): JSX.Element {
  const date = formatDate(story.published_at ?? story.created_at);

  return (
    <article className="space-y-6">
      <header className="space-y-4">
        <div className="flex items-center gap-3">
          <SectorBadge sector={story.sector} />
          {date && <span className="text-sm text-slate-500">{date}</span>}
        </div>
        <h1 className="text-3xl font-bold leading-tight text-slate-900">
          {story.headline}
        </h1>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 text-sm text-slate-600">
            {story.author && (
              <div>
                <span className="font-medium text-slate-900">{story.author.name}</span>
                {story.author.bio && (
                  <span className="ml-2 text-slate-500">{story.author.bio}</span>
                )}
              </div>
            )}
          </div>
          <StorySaveButton story={story} />
        </div>
      </header>

      <PersonalizationBox text={story.why_it_matters_to_you} />

      <section className="space-y-4">
        <div>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-700">
            Context
          </h2>
          <p className="whitespace-pre-line text-base leading-relaxed text-slate-800">
            {story.context}
          </p>
        </div>
        <div>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-700">
            Why it matters
          </h2>
          <p className="whitespace-pre-line text-base leading-relaxed text-slate-800">
            {story.why_it_matters}
          </p>
        </div>
      </section>

      <footer className="flex items-center justify-between border-t border-slate-200 pt-4 text-sm text-slate-500">
        <span className="inline-flex items-center gap-1">
          <MessageSquare className="h-4 w-4" />
          {story.comment_count} comments
        </span>
        {story.source_url && (
          <a
            href={story.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-slate-600 hover:text-violet-700"
          >
            {story.source_name ?? "Read source"}
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </footer>
    </article>
  );
}
