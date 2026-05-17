"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Lock } from "lucide-react";
import { useRelatedStories, useStory } from "@/hooks/useStory";
import { StoryDetail } from "@/components/stories/StoryDetail";
import { StoryCard } from "@/components/stories/StoryCard";
import { UpgradeCtaButton } from "@/components/stories/UpgradeCta";
import { CommentsSection } from "@/components/comments/CommentsSection";
import { extractApiError } from "@/lib/api";
import { isGatePayload } from "@/types/story";

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

  // Phase 12g — gate envelope when the user is over the daily story
  // cap. Headline + first line stay visible per spec; the rest of the
  // surface (comments, related) is suppressed because there's no
  // canonical story id to thread them off (the envelope replaces the
  // full row entirely on this endpoint).
  if (isGatePayload(storyQuery.data)) {
    const gate = storyQuery.data;
    return (
      <div className="space-y-6">
        <Link
          href="/feed"
          className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-violet-700"
        >
          <ArrowLeft className="h-4 w-4" /> Back to feed
        </Link>
        <article className="rounded-lg border border-slate-200 bg-white p-8">
          <h1 className="mb-3 text-2xl font-bold leading-tight text-slate-900">
            {gate.teaser.headline}
          </h1>
          <p className="mb-6 text-base leading-relaxed text-slate-700">
            {gate.teaser.first_line}
          </p>
          <div className="flex flex-col items-start gap-4 rounded-md border border-violet-200 bg-violet-50 p-5">
            <div className="flex items-start gap-2 text-sm text-violet-900">
              <Lock className="mt-0.5 h-4 w-4 flex-none" aria-hidden />
              <span>{gate.upgrade_cta.message}</span>
            </div>
            <UpgradeCtaButton cta={gate.upgrade_cta} />
          </div>
        </article>
      </div>
    );
  }

  const story = storyQuery.data;
  const related = relatedQuery.data ?? [];

  return (
    <div className="space-y-10">
      <Link
        href="/feed"
        className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-violet-700"
      >
        <ArrowLeft className="h-4 w-4" /> Back to feed
      </Link>

      <StoryDetail story={story} />

      <section className="border-t border-slate-200 pt-8">
        <CommentsSection storyId={story.id} />
      </section>

      {related.length > 0 && (
        <section className="space-y-4 border-t border-slate-200 pt-8">
          <h2 className="text-lg font-semibold text-slate-900">Related stories</h2>
          <div className="space-y-4">
            {related.map((s) => (
              <StoryCard key={s.id} story={s} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
