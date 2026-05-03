"use client";

import { ExternalLink, MessageSquare } from "lucide-react";
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

  // Detail is a single-story surface — fire the commentary fetch
  // immediately rather than gating on IntersectionObserver. The
  // 8-slot semaphore still protects against an unlikely burst (e.g. a
  // user rapidly cmd-clicking multiple story links into new tabs,
  // each of which wakes a detail page that mounts this hook).
  const commentaryQuery = useStoryCommentary(story.id, { enabled: true });

  const resolvedCommentary =
    commentaryQuery.data?.commentary ?? story.commentary ?? null;
  const isCommentaryLoading =
    resolvedCommentary === null && commentaryQuery.isFetching;

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
        <div className="flex items-center justify-end">
          <StorySaveButton story={story} />
        </div>
      </header>

      {resolvedCommentary ? (
        <Commentary commentary={resolvedCommentary} />
      ) : (
        <PersonalizationBox
          text={story.why_it_matters_to_you}
          loading={isCommentaryLoading}
        />
      )}

      {/*
        Phase 12e.7b — discrete coverage list for multi-source events.
        Single-source stories keep the existing footer attribution; only
        multi-source items render this section. Primary source carries a
        small badge so the relationship to the footer link is explicit.
      */}
      {story.sources.length > 1 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            Coverage
          </h2>
          <ul className="space-y-1">
            {story.sources.map((s) => (
              <li key={s.url} className="flex items-center gap-2 text-sm">
                {s.role === "primary" && (
                  <span className="rounded bg-violet-100 px-1.5 py-0.5 text-xs font-medium text-violet-700">
                    Primary
                  </span>
                )}
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-slate-600 hover:text-violet-700 hover:underline"
                >
                  {s.name ?? s.url}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-4">
        <div>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-700">
            From the source
          </h2>
          <p className="whitespace-pre-line text-base leading-relaxed text-slate-800">
            {story.context}
          </p>
        </div>
      </section>

      <footer className="flex items-center justify-between border-t border-slate-200 pt-4 text-sm text-slate-500">
        <span className="inline-flex items-center gap-1">
          <MessageSquare className="h-4 w-4" />
          {story.comment_count} comments
        </span>
        {story.source_url && (
          <div className="flex flex-col items-end gap-1">
            <a
              href={story.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-slate-600 hover:text-violet-700"
            >
              {story.source_name ?? "Read source"}
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
            {story.sources.length > 1 && (
              <span className="text-xs text-slate-400">
                Also covered by{" "}
                {story.sources
                  .filter((s) => s.role === "alternate")
                  .map((s) => s.name ?? "unknown")
                  .join(", ")}
              </span>
            )}
          </div>
        )}
      </footer>
    </article>
  );
}
