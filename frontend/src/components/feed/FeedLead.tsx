"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Bookmark, MessageSquare } from "lucide-react";
import { StorySaveButton } from "@/components/stories/StorySaveButton";
import { RelevanceLine } from "@/components/feed/RelevanceLine";
import { useStoryCommentary } from "@/hooks/useStoryCommentary";
import { useTier } from "@/hooks/useTier";
import { useReadStoriesStore } from "@/store/readStoriesStore";
import { timeAgo } from "@/lib/timeAgo";
import { isNativeStory, sourceDisplayLabel, splitHook } from "@/lib/feedCard";
import { isGatePayload, type Story } from "@/types/story";

// The lead — a commanding magazine "cover". A full-bleed hero image under
// a dark scrim with the kicker + oversized serif headline OVERLAID in
// white; the scrim darkens whatever the source image is (a photo OR a
// branded logo card), so the headline always dominates and the lead reads
// as an editorial front page, not a thumbnail. The personalized "why it
// matters" payoff sits directly below.

const EASE: [number, number, number, number] = [0.2, 0.8, 0.2, 1];

const SECTOR_LABEL: Record<string, string> = {
  ai: "Artificial Intelligence",
  finance: "Finance",
  semiconductors: "Semiconductors",
};

const SECTOR_VAR: Record<string, string> = {
  ai: "var(--ai)",
  finance: "var(--finance)",
  semiconductors: "var(--semis)",
};

export function FeedLead({
  story,
  rank,
  followed = false,
}: {
  story: Story;
  rank?: number;
  followed?: boolean;
}): JSX.Element {
  const stamp = timeAgo(story.published_at ?? story.created_at);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const native = isNativeStory(story);
  const commentaryQuery = useStoryCommentary(story.id, { enabled: native });
  const resolved =
    commentaryQuery.data && !isGatePayload(commentaryQuery.data)
      ? commentaryQuery.data.commentary
      : null;
  const loading = native && resolved === null && commentaryQuery.isFetching;
  const body = resolved?.thesis ?? story.why_it_matters_to_you;

  const isRead = useReadStoriesStore((s) => s.isRead(story.id));
  const tier = useTier().data?.tier;
  const isPersonalized = tier === "pro" || tier === "pro_trial";
  const sectorColor = SECTOR_VAR[story.sector] ?? "var(--ink-muted)";
  const sectorLabel = SECTOR_LABEL[story.sector] ?? story.sector;
  const source = sourceDisplayLabel(story);
  const heroImage = story.image_url ?? (native ? story.illustration_url : null);
  const { hookTitle, commentaryBody } = splitHook(
    story.generic_commentary,
    story.headline,
  );
  const attribution = hookTitle === story.headline ? null : story.headline;
  const overlayHeadline = native ? story.headline : hookTitle;

  return (
    <motion.article
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.42, ease: EASE }}
      className="group relative"
    >
      <Link href={`/stories/${story.id}`} className="block hover:no-underline">
        {/* Commanding hero with overlaid headline */}
        <div className="relative mb-5 overflow-hidden rounded-xl border border-line">
          <div className="relative aspect-[16/10] w-full sm:aspect-[16/9]">
            {heroImage ? (
              <Image
                src={heroImage}
                alt=""
                fill
                unoptimized
                priority
                sizes="(max-width: 1024px) 100vw, 62vw"
                className="object-cover transition-transform duration-[600ms] ease-soft-out group-hover:scale-[1.03]"
              />
            ) : (
              <div
                aria-hidden
                className="absolute inset-0"
                style={{
                  background: `linear-gradient(135deg, color-mix(in srgb, ${sectorColor} 60%, #050505) 0%, #070707 78%)`,
                }}
              />
            )}
            {/* Legibility scrim */}
            <div
              aria-hidden
              className="absolute inset-0"
              style={{
                background:
                  "linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.5) 36%, rgba(0,0,0,0.05) 72%)",
              }}
            />
            {/* Overlaid kicker + headline */}
            <div className="absolute inset-x-0 bottom-0 p-5 md:p-7">
              <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-white">
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: sectorColor }}
                  />
                  {sectorLabel}
                </span>
                {source && (
                  <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-white/60">
                    via {source}
                  </span>
                )}
              </div>
              <h2
                className={[
                  "font-display text-[28px] font-bold leading-[1.04] tracking-tight text-white md:text-[44px]",
                  isRead ? "opacity-70" : "",
                ].join(" ")}
                style={{
                  display: "-webkit-box",
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {overlayHeadline}
              </h2>
              {!native && attribution && (
                <p className="mt-2 max-w-[64ch] truncate text-[13px] text-white/70">
                  {attribution}
                </p>
              )}
              {/* Personalization payoff inside the hero — visible without
                  scrolling past the image. Accent-colored so it pops. */}
              {(rank != null || followed) && (
                <p className="mt-3 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-accent">
                  {rank != null && `#${rank} for you`}
                  {rank != null && followed && " · "}
                  {followed && `${sectorLabel} · your focus`}
                </p>
              )}
            </div>
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 bottom-0 h-1"
              style={{ backgroundColor: sectorColor }}
            />
          </div>
        </div>

        {/* The personalized payoff, directly under the hero */}
        {native ? (
          <>
            <p className="mb-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-accent">
              {isPersonalized ? "Why it matters to you" : "Why it matters"}
            </p>
            <div className="relative min-h-[4.5rem]">
              <AnimatePresence mode="wait" initial={false}>
                <motion.p
                  key={loading ? "loading" : "body"}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18, ease: EASE }}
                  className="max-w-[64ch] text-[16px] leading-relaxed text-ink-muted"
                  style={
                    loading
                      ? { color: "var(--ink-muted)" }
                      : {
                          display: "-webkit-box",
                          WebkitLineClamp: 3,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }
                  }
                >
                  {loading ? (
                    <span aria-hidden className="block space-y-2">
                      <span className="skeleton block h-4 w-full rounded" />
                      <span className="skeleton block h-4 w-11/12 rounded" />
                      <span className="skeleton block h-4 w-3/4 rounded" />
                    </span>
                  ) : (
                    body
                  )}
                </motion.p>
              </AnimatePresence>
            </div>
          </>
        ) : (
          commentaryBody && (
            <p
              className="max-w-[64ch] text-[16px] leading-relaxed text-ink-muted"
              style={{
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {commentaryBody}
            </p>
          )
        )}
      </Link>

      {/* Editorial meta line */}
      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-4 text-ink-muted">
        {stamp && (
          <span className="font-mono text-[11px] uppercase tracking-wide">{stamp}</span>
        )}
        {story.reading_time_minutes != null && (
          <span className="font-mono text-[11px] uppercase tracking-wide">
            {story.reading_time_minutes} min read
          </span>
        )}
        {story.comment_count > 0 && (
          <span className="inline-flex items-center gap-1 text-xs">
            <MessageSquare className="h-3.5 w-3.5" />
            {story.comment_count}
          </span>
        )}
        <span className="ml-auto">
          {mounted ? (
            <StorySaveButton story={story} />
          ) : (
            <span className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs text-ink-muted">
              <Bookmark className="h-3.5 w-3.5" /> Save
            </span>
          )}
        </span>
      </div>
    </motion.article>
  );
}
