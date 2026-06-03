"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, MessageSquare } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import type { Story } from "@/types/story";
import { isNativeStory, sourceDisplayLabel, splitHook } from "@/lib/feedCard";
import { timeAgo } from "@/lib/timeAgo";

// Design B — "The Terminal". A dark, dense, ranked intelligence surface:
// a mono masthead, one commanding lead "signal", then a numbered ranked
// list (01–N) of dense rows. Distinct information architecture from
// Design A's warm magazine grid — this reads like a trading-desk briefing.

const SECTOR_LABEL: Record<string, string> = {
  ai: "AI",
  finance: "FINANCE",
  semiconductors: "SEMIS",
};
const SECTOR_VAR: Record<string, string> = {
  ai: "var(--ai)",
  finance: "var(--finance)",
  semiconductors: "var(--semis)",
};

function sectorColor(sector: string): string {
  return SECTOR_VAR[sector] ?? "var(--ink-muted)";
}

function titleFor(story: Story): { title: string; dek: string | null } {
  if (isNativeStory(story)) {
    return { title: story.headline, dek: story.why_it_matters_to_you || null };
  }
  const { hookTitle, commentaryBody } = splitHook(
    story.generic_commentary,
    story.headline,
  );
  return { title: hookTitle, dek: commentaryBody };
}

function Kicker({ story }: { story: Story }): JSX.Element {
  const source = sourceDisplayLabel(story);
  return (
    <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em]">
      <span
        className="inline-flex items-center gap-1.5 font-medium"
        style={{ color: sectorColor(story.sector) }}
      >
        <span
          aria-hidden
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: sectorColor(story.sector) }}
        />
        {SECTOR_LABEL[story.sector] ?? story.sector}
      </span>
      {source && <span className="text-ink-muted">/ {source}</span>}
    </div>
  );
}

function Masthead({ count }: { count: number }): JSX.Element {
  const [dateLabel, setDateLabel] = useState("");
  useEffect(() => {
    setDateLabel(
      new Date()
        .toLocaleDateString("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
        })
        .toUpperCase(),
    );
  }, []);

  return (
    <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b border-line pb-4">
      <div className="flex items-baseline gap-3">
        <span className="font-display text-xl font-bold tracking-[0.18em] text-ink">
          VALO
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
          Intelligence
        </span>
      </div>
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">
        {dateLabel ? `${dateLabel} · ` : ""}
        <span className="text-ink">{count} signals today</span>
      </div>
    </header>
  );
}

function TerminalLead({ story }: { story: Story }): JSX.Element {
  const reduce = useReducedMotion();
  const { title, dek } = titleFor(story);
  const stamp = timeAgo(story.published_at ?? story.created_at);

  return (
    <motion.article
      initial={reduce ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
      className="relative mt-8"
    >
      <span
        aria-hidden
        className="absolute -left-5 top-1 hidden h-[calc(100%-0.5rem)] w-[3px] rounded md:block"
        style={{ backgroundColor: sectorColor(story.sector) }}
      />
      <Link href={`/stories/${story.id}`} className="group block hover:no-underline">
        <div className="mb-3 flex items-center gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">
            Lead signal
          </span>
          <Kicker story={story} />
        </div>
        <h1 className="font-display text-[34px] font-bold leading-[1.04] tracking-tight text-ink transition-colors duration-150 group-hover:text-accent md:text-[48px]">
          {title}
        </h1>
        {dek && (
          <p
            className="mt-4 max-w-[64ch] text-[16px] leading-relaxed text-ink-muted"
            style={{
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {dek}
          </p>
        )}
      </Link>
      <div className="mt-5 flex items-center gap-4 border-t border-line pt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted">
        {stamp && <span>{stamp}</span>}
        {story.reading_time_minutes != null && (
          <span>{story.reading_time_minutes} min</span>
        )}
        {story.comment_count > 0 && (
          <span className="inline-flex items-center gap-1 normal-case tracking-normal">
            <MessageSquare className="h-3.5 w-3.5" />
            {story.comment_count}
          </span>
        )}
      </div>
    </motion.article>
  );
}

function TerminalRow({
  story,
  rank,
}: {
  story: Story;
  rank: number;
}): JSX.Element {
  const { title, dek } = titleFor(story);
  const stamp = timeAgo(story.published_at ?? story.created_at);

  return (
    <li>
      <Link
        href={`/stories/${story.id}`}
        className="group flex gap-4 rounded-lg border border-transparent px-3 py-4 transition-colors duration-150 hover:border-line hover:bg-surface hover:no-underline"
      >
        <span
          className="w-7 flex-none pt-0.5 font-mono text-[15px] font-semibold tabular-nums"
          style={{ color: sectorColor(story.sector) }}
        >
          {String(rank).padStart(2, "0")}
        </span>
        <span className="min-w-0 flex-1">
          <span className="mb-1.5 block">
            <Kicker story={story} />
          </span>
          <h3 className="font-display text-[18px] font-semibold leading-snug text-ink transition-colors duration-150 group-hover:text-accent">
            {title}
          </h3>
          {dek && (
            <span
              className="mt-1 block text-[13.5px] leading-relaxed text-ink-muted"
              style={{
                display: "-webkit-box",
                WebkitLineClamp: 1,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {dek}
            </span>
          )}
        </span>
        <span className="flex flex-none flex-col items-end gap-1 pt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-muted">
          {stamp && <span>{stamp}</span>}
          <ArrowUpRight className="h-4 w-4 opacity-0 transition-opacity duration-150 group-hover:opacity-100 text-accent" />
        </span>
      </Link>
    </li>
  );
}

export function TerminalFeed({ stories }: { stories: Story[] }): JSX.Element {
  const [lead, ...rest] = stories;

  return (
    <div className="theme-terminal min-h-dvh bg-bg text-ink">
      <div className="mx-auto max-w-[1080px] px-5 py-8 md:px-8">
        <Masthead count={stories.length} />
        {lead && <TerminalLead story={lead} />}

        {rest.length > 0 && (
          <section className="mt-12">
            <div className="mb-2 flex items-center gap-3 border-t border-line pt-4">
              <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-muted">
                The ranked feed
              </h2>
              <span
                aria-hidden
                className="h-px flex-1"
                style={{
                  background:
                    "linear-gradient(90deg, var(--line), transparent)",
                }}
              />
            </div>
            <ol className="divide-y divide-line">
              {rest.map((story, i) => (
                <TerminalRow key={story.id} story={story} rank={i + 2} />
              ))}
            </ol>
          </section>
        )}
      </div>
    </div>
  );
}

export function TerminalFeedSkeleton(): JSX.Element {
  return (
    <div className="theme-terminal min-h-dvh bg-bg text-ink">
      <div className="mx-auto max-w-[1080px] px-5 py-8 md:px-8">
        <div className="h-6 w-40 skeleton rounded" />
        <div className="mt-10 space-y-3">
          <div className="h-12 w-3/4 skeleton rounded" />
          <div className="h-12 w-1/2 skeleton rounded" />
        </div>
        <div className="mt-12 space-y-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex gap-4">
              <div className="h-5 w-7 skeleton rounded" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-2/3 skeleton rounded" />
                <div className="h-3 w-1/3 skeleton rounded" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
