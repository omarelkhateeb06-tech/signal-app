"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useRelatedStories, useStory } from "@/hooks/useStory";
import { StoryDetail } from "@/components/stories/StoryDetail";
import { StoryCard } from "@/components/stories/StoryCard";
import { CommentsSection } from "@/components/comments/CommentsSection";
import { extractApiError } from "@/lib/api";

export default function StoryPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? null;
  const storyQuery = useStory(id);
  const relatedQuery = useRelatedStories(id);

  if (storyQuery.isLoading) {
    return <div className="py-12 text-center text-sm text-slate-500">Loading…</div>;
  }

  if (storyQuery.error || !storyQuery.data) {
    return (
      <div className="space-y-4">
        <Link
          href="/feed"
          className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-violet-700"
        >
          <ArrowLeft className="h-4 w-4" /> Back to feed
        </Link>
        <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          {extractApiError(storyQuery.error, "Story not found.")}
        </div>
      </div>
    );
  }

  const related = relatedQuery.data ?? [];

  return (
    <div className="space-y-10">
      <Link
        href="/feed"
        className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-violet-700"
      >
        <ArrowLeft className="h-4 w-4" /> Back to feed
      </Link>

      <StoryDetail story={storyQuery.data} />

      <section className="border-t border-slate-200 pt-8">
        <CommentsSection storyId={storyQuery.data.id} />
      </section>

      {related.length > 0 && (
        <section className="space-y-4 border-t border-slate-200 pt-8">
          <h2 className="text-lg font-semibold text-slate-900">Related stories</h2>
          <div className="space-y-4">
            {related.map((story) => (
              <StoryCard key={story.id} story={story} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
