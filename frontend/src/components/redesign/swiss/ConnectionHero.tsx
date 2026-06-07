"use client";

import clsx from "clsx";
import { ArrowRight } from "lucide-react";
import type { Story } from "@/types/story";
import { matchPercent, storyTitleAndBrief, SECTOR_SHORT } from "./swissView";
import { AiArtBadge } from "./AiArtBadge";

// Redesign v2 — THE CONNECTION hero.
//
// The flagship content type (cross-sector causal chain) is the #1
// differentiator, so it is the one card that breaks the uniform ranked-stream
// grid: a full-width, illustrated unit at the top of the stream. Everything it
// renders comes from fields already on the wire (illustration_url / image_url,
// the lead-with-explanation brief, sector, sources). When no illustration is
// present it falls back to an abstract A → B → C chain motif rather than an
// empty box — the causal-chain idea visualised, not a placeholder.

interface ConnectionHeroProps {
  story: Story;
  rank: number;
  isActive: boolean;
  onSelect: (storyId: string) => void;
}

function ChainMotif(): JSX.Element {
  // Abstract causal chain — three nodes linked A → B → C. Decorative only
  // (no fabricated node labels); it signals "this connects things" at a
  // glance when a real illustration is absent.
  return (
    <div
      aria-hidden
      className="flex h-full w-full items-center justify-center gap-3 px-6"
    >
      {[0, 1, 2].map((n) => (
        <div key={n} className="flex items-center gap-3">
          <span
            className={clsx(
              "inline-block h-3 w-3 rotate-45 border-2",
              n === 1 ? "border-accent bg-accent/30" : "border-accent/70",
            )}
          />
          {n < 2 && (
            <ArrowRight className="h-4 w-4 text-accent/60" aria-hidden />
          )}
        </div>
      ))}
    </div>
  );
}

export function ConnectionHero({
  story,
  rank,
  isActive,
  onSelect,
}: ConnectionHeroProps): JSX.Element {
  const sourceCount = Math.max(1, story.sources.length);
  const matchPct = matchPercent(rank, sourceCount);
  const { title, brief } = storyTitleAndBrief(story);
  const art = story.illustration_url ?? story.image_url ?? null;
  const aiArt = art != null && art === story.illustration_url;

  return (
    <button
      type="button"
      onClick={() => onSelect(story.id)}
      aria-pressed={isActive}
      className={clsx(
        "group mb-2 block w-full border text-left transition-colors",
        isActive
          ? "border-accent bg-accent/[0.06]"
          : "border-ink/80 hover:border-accent",
      )}
    >
      {/* Illustration band — real art when present, chain motif otherwise. */}
      <div className="relative h-[200px] w-full overflow-hidden bg-ink md:h-[240px]">
        {art ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={art}
            alt=""
            className="h-full w-full object-cover opacity-90 transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="h-full w-full bg-[radial-gradient(circle_at_30%_30%,_rgba(139,69,19,0.18),_transparent_60%)]">
            <ChainMotif />
          </div>
        )}
        <span className="absolute left-4 top-4 inline-flex items-center gap-2 border border-accent bg-bg/95 px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-accent">
          The Connection
        </span>
        {aiArt && <AiArtBadge />}
      </div>

      <div className="px-5 py-5 md:px-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">
          <span className="font-semibold text-accent">
            {rank === 1 ? "Rank 1" : String(rank).padStart(2, "0")}
          </span>
          <span className="text-line">{"//"}</span>
          <span>{SECTOR_SHORT[story.sector] ?? story.sector}</span>
          {sourceCount > 1 && <span>· {sourceCount} sources</span>}
          <span className="border border-accent/40 px-1.5 py-0.5 font-semibold text-accent">
            {matchPct}% match
          </span>
        </div>

        <h3
          className={clsx(
            "mt-2 font-display text-[24px] font-semibold leading-tight transition-colors md:text-[28px]",
            isActive ? "text-accent" : "text-ink group-hover:text-accent",
          )}
        >
          {title}
        </h3>

        {brief && (
          <p
            className="mt-2 font-serif text-[15px] italic leading-relaxed text-ink-muted"
            style={{
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {brief}
          </p>
        )}

        <span className="mt-3 inline-flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">
          Trace the chain
          <ArrowRight
            className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
            aria-hidden
          />
        </span>
      </div>
    </button>
  );
}
