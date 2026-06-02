"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { Bookmark, MessageSquare } from "lucide-react";
import { StorySaveButton } from "@/components/stories/StorySaveButton";
import { useStoryCommentary } from "@/hooks/useStoryCommentary";
import { useReadStoriesStore } from "@/store/readStoriesStore";
import { timeAgo } from "@/lib/timeAgo";
import { isNativeStory, sourceDisplayLabel, splitHook } from "@/lib/feedCard";
import { isGatePayload, type Story } from "@/types/story";

// "Intelligence Terminal × Editorial" front page — the lead story.
// One commanding story at the top-left of the briefing: large hero
// image, sector kicker, oversized serif headline, two lines of
// personalized commentary, and an editorial meta line. Commentary
// hydrates immediately (this is above the fold and is the single most
// important thing on the page — it has to sell the "why it matters to
// you" promise on first paint).

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

export function FeedLead({ story }: { story: Story }): JSX.Element {
  const stamp = timeAgo(story.published_at ?? story.created_at);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Only native (SIGNAL editorial) leads keep the lazy personalized
  // commentary. Ingested leads build all three sections from
  // `generic_commentary` on the wire, so they don't fetch.
  const native = isNativeStory(story);
  const commentaryQuery = useStoryCommentary(story.id, { enabled: native });
  const resolved =
    commentaryQuery.data && !isGatePayload(commentaryQuery.data)
      ? commentaryQuery.data.commentary
      : null;
  const loading = native && resolved === null && commentaryQuery.isFetching;
  const body = resolved?.thesis ?? story.why_it_matters_to_you;

  const isRead = useReadStoriesStore((s) => s.isRead(story.id));
  const sectorColor = SECTOR_VAR[story.sector] ?? "var(--ink-muted)";
  const sectorLabel = SECTOR_LABEL[story.sector] ?? story.sector;
  // Phase 12o — native posts brand the kicker by generator
  // ("The Research Read", …); ingested posts show their source name.
  const source = sourceDisplayLabel(story);
  // Ingested three-section split: hook title (first sentence) + body.
  const { hookTitle, commentaryBody } = splitHook(
    story.generic_commentary,
    story.headline,
  );
  const attribution = hookTitle === story.headline ? null : story.headline;

  return (
    <motion.article
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.42, ease: EASE }}
      className="group relative"
    >
      <Link href={`/stories/${story.id}`} className="block hover:no-underline">
        {story.image_url && (
          <div className="relative mb-5 overflow-hidden rounded-lg border border-line">
            <div className="aspect-[16/9] w-full">
              <Image
                src={story.image_url}
                alt=""
                fill
                unoptimized
                sizes="(max-width: 1024px) 100vw, 60vw"
                className="object-cover transition-transform duration-[600ms] ease-soft-out group-hover:scale-[1.02]"
              />
            </div>
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 bottom-0 h-1"
              style={{ backgroundColor: sectorColor }}
            />
          </div>
        )}

        {/* Sector kicker + source — uppercase mono, the "section dateline" */}
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span
            className="inline-flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.14em]"
            style={{ color: sectorColor }}
          >
            <span
              aria-hidden
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: sectorColor }}
            />
            {sectorLabel}
          </span>
          {source && (
            <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink-muted">
              via {source}
            </span>
          )}
        </div>

        {native ? (
          <>
            {/* Native (SIGNAL editorial): classic headline + framed
                commentary, left untouched by the hook-as-title swap. */}
            <h2
              className={[
                "font-display text-[32px] font-semibold leading-[1.08] tracking-tight transition-colors duration-150 md:text-[40px]",
                isRead ? "text-ink-muted" : "text-ink group-hover:text-accent",
              ].join(" ")}
            >
              {story.headline}
            </h2>

            <p className="mb-1.5 mt-5 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-accent">
              Why it matters to you
            </p>
            <div className="relative min-h-[4.5rem]">
              <AnimatePresence mode="wait" initial={false}>
                <motion.p
                  key={loading ? "loading" : "body"}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18, ease: EASE }}
                  className="max-w-[58ch] text-[16px] leading-relaxed text-ink-muted"
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
                  {loading ? "Generating your briefing…" : body}
                </motion.p>
              </AnimatePresence>
            </div>
          </>
        ) : (
          <>
            {/* Ingested: three sections — hook title (first sentence of
                generic_commentary) as the hero headline, the source
                article headline as muted attribution, then the commentary
                body. The "Why it matters to you" label is dropped — the
                hook now speaks for itself as the headline. */}
            <h2
              className={[
                "font-display text-[32px] font-semibold leading-[1.08] tracking-tight transition-colors duration-150 md:text-[40px]",
                isRead ? "text-ink-muted" : "text-ink group-hover:text-accent",
              ].join(" ")}
              style={{
                display: "-webkit-box",
                WebkitLineClamp: 3,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {hookTitle}
            </h2>
            {attribution && (
              <p className="mt-3 max-w-[58ch] truncate text-[15px] leading-relaxed text-ink-muted">
                {attribution}
              </p>
            )}
            {commentaryBody && (
              <p
                className="mt-4 max-w-[58ch] text-[16px] leading-relaxed text-ink-muted"
                style={{
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {commentaryBody}
              </p>
            )}
          </>
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
