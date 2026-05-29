"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, Lock } from "lucide-react";
import { useRelatedStories, useStory } from "@/hooks/useStory";
import { StoryDetail } from "@/components/stories/StoryDetail";
import { StoryCard } from "@/components/stories/StoryCard";
import { UpgradeCtaButton } from "@/components/stories/UpgradeCta";
import { CommentsSection } from "@/components/comments/CommentsSection";
import { Card } from "@/components/ui/Card";
import { useReadStoriesStore } from "@/store/readStoriesStore";
import { extractApiError } from "@/lib/api";
import { isGatePayload } from "@/types/story";

function BackLink(): JSX.Element {
  return (
    <Link
      href="/feed"
      className="inline-flex items-center gap-1 text-sm text-ink-muted transition-colors hover:text-ink hover:no-underline"
    >
      <ArrowLeft className="h-4 w-4" /> Back to briefing
    </Link>
  );
}

export default function StoryPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? null;
  const storyQuery = useStory(id);
  const relatedQuery = useRelatedStories(id);
  const markRead = useReadStoriesStore((s) => s.markRead);

  // Mark the story read on open so the feed dims its headline. Client-
  // side only (localStorage) — never blocks render and ignores gates.
  const storyData = storyQuery.data;
  useEffect(() => {
    if (id && storyData && !isGatePayload(storyData)) {
      markRead(id);
    }
  }, [id, storyData, markRead]);

  if (storyQuery.isLoading) {
    return (
      <div className="py-12 text-center text-sm text-ink-muted">Loading…</div>
    );
  }

  if (storyQuery.error || !storyQuery.data) {
    return (
      <div className="mx-auto max-w-3xl space-y-6 py-6">
        <BackLink />
        <div className="rounded-md border border-err/40 bg-err/5 p-4 text-sm text-err">
          {extractApiError(storyQuery.error, "Story not found.")}
        </div>
      </div>
    );
  }

  // Phase 12g — gate envelope when the user is over the daily story
  // cap. Headline + first line stay visible per spec; the rest of the
  // surface (comments, related) is suppressed because there's no
  // canonical story id to thread them off.
  if (isGatePayload(storyQuery.data)) {
    const gate = storyQuery.data;
    return (
      <div className="mx-auto max-w-3xl space-y-6 py-6">
        <BackLink />
        <Card className="p-8">
          <h1 className="mb-3 font-display text-[28px] font-semibold leading-tight text-ink">
            {gate.teaser.headline}
          </h1>
          <p className="mb-6 text-base leading-relaxed text-ink-muted">
            {gate.teaser.first_line}
          </p>
          <div
            className="flex flex-col items-start gap-4 rounded-md border border-line p-5"
            style={{
              backgroundColor:
                "color-mix(in srgb, var(--accent) 6%, var(--surface))",
            }}
          >
            <div className="flex items-start gap-2 text-sm text-ink">
              <Lock className="mt-0.5 h-4 w-4 flex-none text-accent" aria-hidden />
              <span>{gate.upgrade_cta.message}</span>
            </div>
            <UpgradeCtaButton cta={gate.upgrade_cta} />
          </div>
        </Card>
      </div>
    );
  }

  const story = storyQuery.data;
  const related = relatedQuery.data ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-10 py-6">
      <BackLink />

      <StoryDetail story={story} />

      <section className="border-t border-line pt-8">
        <CommentsSection storyId={story.id} />
      </section>

      {related.length > 0 && (
        <section className="space-y-5 border-t border-line pt-8">
          <div className="flex items-center gap-3">
            <span aria-hidden className="h-2 w-2 flex-none rounded-[2px] bg-accent" />
            <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-ink">
              Related stories
            </h2>
            <span className="h-px flex-1 bg-line" aria-hidden />
          </div>
          <motion.div
            className="grid grid-cols-1 gap-5 md:grid-cols-2 md:gap-6"
            variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.06 } } }}
            initial="hidden"
            animate="visible"
          >
            {related.map((s, i) => (
              <StoryCard key={s.id} story={s} index={i} animated />
            ))}
          </motion.div>
        </section>
      )}
    </div>
  );
}
