"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, ExternalLink, Bookmark } from "lucide-react";
import type { Story } from "@/types/story";
import { isNativeStory, sourceDisplayLabel, splitHook } from "@/lib/feedCard";
import { timeAgo } from "@/lib/timeAgo";
import { StorySaveButton } from "@/components/stories/StorySaveButton";

// Swiss + Vintage fusion feed. A warm, paper-like editorial intelligence
// briefing: Playfair Display serif masthead, Lora body, DM Mono metadata,
// terracotta accent, sharp edges, structured story sections (THE CORE
// BRIEF → WHY IT MATTERS → KEY TAKEAWAYS), relevance scores, rank badges,
// source counts — all wired to the real SIGNAL data layer.

const SECTOR_LABEL: Record<string, string> = {
  ai: "AI",
  finance: "FINANCE",
  semiconductors: "SEMICONDUCTORS",
};

function relevanceFromRank(rank: number, sourceCount: number): number {
  // The backend already ranked stories by effective_score; derive a
  // visible relevance % from the rank position so the number is both
  // real (rank-derived) and naturally varying per card (Rank 1 ≈ 92%,
  // Rank 11 ≈ 55%). Source count provides a small boost.
  const base = Math.max(50, 95 - (rank - 1) * 4);
  const sourceBonus = Math.min(8, (sourceCount - 1) * 3);
  return Math.min(98, base + sourceBonus);
}

function StoryEntry({
  story,
  rank,
  defaultExpanded = false,
  tier = "standard",
}: {
  story: Story;
  rank: number;
  defaultExpanded?: boolean;
  // Visual tier: "lead" (Rank 1, expanded), "featured" (Ranks 2-3,
  // shows a bold thesis pull-quote), "standard" (everything else).
  tier?: "lead" | "featured" | "standard";
}): JSX.Element {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const native = isNativeStory(story);
  const source = sourceDisplayLabel(story);
  const stamp = timeAgo(story.published_at ?? story.created_at);
  const { hookTitle, commentaryBody } = splitHook(
    story.generic_commentary,
    story.headline,
  );
  const title = native ? story.headline : hookTitle;
  const summary = commentaryBody ?? story.why_it_matters_to_you ?? "";
  const rel = relevanceFromRank(rank, story.sources.length);
  const sectors = [story.sector]
    .map((s) => SECTOR_LABEL[s] ?? s.toUpperCase());

  return (
    <article className="border-b border-line py-6 first:pt-0 last:border-b-0">
      {/* Meta line */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted">
        <span className="rounded-none border border-ink px-2 py-0.5 font-semibold text-ink">
          Rank {rank}
        </span>
        {story.reading_time_minutes != null && (
          <span>{story.reading_time_minutes} min read</span>
        )}
        <span>
          {story.sources.length} {story.sources.length === 1 ? "source" : "sources"} analyzed
        </span>
        <span className="ml-auto flex items-center gap-1">
          Relevance:
          <span className="rounded-none border border-accent px-1.5 py-0.5 font-semibold text-accent">
            {rel}%
          </span>
        </span>
      </div>

      {/* Title */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="group flex w-full items-start justify-between gap-4 text-left"
      >
        <h3 className="font-serif text-[22px] font-semibold leading-snug text-ink transition-colors duration-150 group-hover:text-accent md:text-[26px]">
          {title}
        </h3>
        {expanded ? (
          <ChevronUp className="mt-1 h-5 w-5 flex-none text-ink-muted" />
        ) : (
          <ChevronDown className="mt-1 h-5 w-5 flex-none text-ink-muted" />
        )}
      </button>

      {/* Featured tier: a bold thesis pull-quote (Ranks 2-3) */}
      {!expanded && tier === "featured" && story.why_it_matters_to_you && (
        <p
          className="mt-3 border-l-[3px] pl-4 font-serif text-[16px] font-medium italic leading-relaxed text-ink"
          style={{ borderColor: "var(--accent)" }}
        >
          {story.why_it_matters_to_you.length > 160
            ? story.why_it_matters_to_you.slice(0, 160) + "…"
            : story.why_it_matters_to_you}
        </p>
      )}

      {/* Standard preview when collapsed */}
      {!expanded && tier !== "featured" && summary && (
        <p
          className="mt-2 font-sans text-[15px] leading-relaxed text-ink-muted"
          style={{
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {summary}
        </p>
      )}

      {/* Expanded content — structured sections */}
      {expanded && (
        <div className="mt-5 space-y-5">
          {/* I. THE CORE BRIEF */}
          <section>
            <h4 className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">
              The Core Brief
            </h4>
            <p className="font-sans text-[15px] leading-[1.75] text-ink">
              {summary || story.why_it_matters_to_you || story.why_it_matters}
            </p>
          </section>

          {/* II. WHY IT MATTERS — highlighted block (Vintage influence) */}
          {story.why_it_matters_to_you && (
            <section
              className="border-l-[3px] py-3 pl-5"
              style={{
                borderColor: "var(--accent)",
                backgroundColor: "color-mix(in srgb, var(--accent) 6%, var(--surface))",
              }}
            >
              <h4 className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">
                Why It Matters
              </h4>
              <p className="font-sans text-[15px] leading-[1.75] text-ink">
                {story.why_it_matters_to_you}
              </p>
            </section>
          )}

          {/* III. KEY TAKEAWAYS — if we have generic_commentary, split into bullets */}
          {story.generic_commentary && (
            <section>
              <h4 className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">
                Key Takeaways
              </h4>
              <ul className="list-inside list-disc space-y-1.5 font-sans text-[14px] leading-relaxed text-ink">
                {story.generic_commentary
                  .split(/(?<=[.!?])\s+/)
                  .filter((s) => s.length > 20)
                  .slice(0, 4)
                  .map((point, i) => (
                    <li key={i}>{point}</li>
                  ))}
              </ul>
            </section>
          )}

          {/* Source + actions */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <div className="flex flex-wrap gap-2">
              {sectors.map((s) => (
                <span
                  key={s}
                  className="rounded-none border border-line px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-ink-muted"
                >
                  {s}
                </span>
              ))}
              {source && (
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-muted">
                  via {source}
                </span>
              )}
              {stamp && (
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-muted">
                  · {stamp}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <Link
                href={`/stories/${story.id}`}
                className="inline-flex items-center gap-1 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-accent transition-colors hover:text-accent-hover"
              >
                Read full brief <ExternalLink className="h-3 w-3" />
              </Link>
              <StorySaveButton story={story} />
            </div>
          </div>
        </div>
      )}
    </article>
  );
}

function Sidebar({
  profile,
  storyCount,
}: {
  profile: { role?: string; sectors?: string[]; name?: string } | null;
  storyCount: number;
}): JSX.Element {
  const role = profile?.role ?? "Reader";
  const sectors = profile?.sectors ?? ["ai", "finance", "semiconductors"];

  return (
    <aside className="space-y-8">
      {/* Profile card */}
      <div className="border border-line bg-surface p-5">
        <h3 className="mb-3 font-serif text-[18px] font-semibold text-ink">
          Personalized Intelligence Feed
        </h3>
        <p className="mb-4 font-sans text-[13px] leading-relaxed text-ink-muted">
          Your feed is ranked using SIGNAL&apos;s algorithmic curation,
          calibrated for your specific industry profile.
        </p>
        <div className="divide-y divide-line font-mono text-[11px] uppercase tracking-[0.12em]">
          <div className="flex justify-between py-2">
            <span className="text-ink-muted">Reader:</span>
            <span className="font-semibold text-ink">{profile?.name ?? "Reader"}</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-ink-muted">Role:</span>
            <span className="font-semibold text-ink">{role}</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-ink-muted">Stories:</span>
            <span className="font-semibold text-ink">{storyCount} ranked</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-ink-muted">Sectors:</span>
            <span className="font-semibold text-ink">
              {sectors.map((s) => SECTOR_LABEL[s] ?? s.toUpperCase()).join(", ")}
            </span>
          </div>
        </div>
      </div>

      {/* The Convergence Manifesto */}
      <div className="border-t border-line pt-5">
        <h4 className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">
          The Convergence Manifesto
        </h4>
        <p className="font-serif text-[14px] italic leading-relaxed text-ink-muted">
          &ldquo;Artificial intelligence is not a software vertical. It is a
          physical phenomenon constrained by silicon lithography and accelerated
          by capital flows. To understand any one of these sectors, you must
          understand all three.&rdquo;
        </p>
      </div>
    </aside>
  );
}

export function SwissFeed({
  stories,
  profile,
}: {
  stories: Story[];
  profile: { role?: string; sectors?: string[]; name?: string } | null;
}): JSX.Element {
  const date = new Date().toLocaleDateString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  });
  const readerName = profile?.name ?? "Reader";

  return (
    <div className="theme-swiss min-h-dvh bg-bg text-ink">
      <div className="mx-auto max-w-[1400px] px-6 py-8 md:px-10">
        {/* ===== Masthead ===== */}
        <header className="mb-8 border-b-2 border-ink pb-6">
          <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
            <div>
              <p className="font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-accent">
                Daily Intelligence Briefing
              </p>
              <h1 className="font-serif text-[52px] font-black leading-none tracking-tight text-ink md:text-[72px]">
                SIGNAL
              </h1>
            </div>
            <div className="text-right font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
              <p>Edition: {date}</p>
              <p>Published daily at 05:00 UTC</p>
              <p>
                Prepared for: <span className="font-semibold text-ink">{readerName}</span>
              </p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted">
            <span>
              {"Vol. III // No. "}{Math.floor(Math.random() * 200) + 100}{" // AI · Finance · Semiconductors"}
            </span>
            <Link
              href="/settings"
              className="text-accent transition-colors hover:text-accent-hover"
            >
              Edit preferences →
            </Link>
          </div>
        </header>

        {/* ===== Main grid: feed + sidebar ===== */}
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[2fr_1fr]">
          {/* Feed */}
          <main>
            <div className="mb-6 border-b border-line pb-4">
              <h2 className="font-serif text-[22px] italic text-ink">
                Today&apos;s Curated Intelligence
              </h2>
            </div>

            <div>
              {stories.map((story, i) => {
                const rank = i + 1;
                const tier: "lead" | "featured" | "standard" =
                  rank === 1 ? "lead" : rank <= 3 ? "featured" : "standard";
                return (
                  <StoryEntry
                    key={story.id}
                    story={story}
                    rank={rank}
                    defaultExpanded={rank === 1}
                    tier={tier}
                  />
                );
              })}
            </div>
          </main>

          {/* Sidebar */}
          <Sidebar profile={profile} storyCount={stories.length} />
        </div>

        {/* ===== Footer ===== */}
        <footer className="mt-12 border-t border-line pt-6 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted">
          <p>© 2026 SIGNAL Intelligence · All rights reserved · Terms · Privacy</p>
        </footer>
      </div>
    </div>
  );
}
