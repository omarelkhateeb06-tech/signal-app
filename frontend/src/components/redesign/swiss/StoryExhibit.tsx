"use client";

import Link from "next/link";
import {
  Lock,
  MessageSquare,
  Layers,
  ArrowRight,
  Network,
  GraduationCap,
  MessagesSquare,
  Wrench,
  Newspaper,
  Sparkles,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import clsx from "clsx";
import type { Story, FeedGatedStory } from "@/types/story";
import { sourceDisplayLabel } from "@/lib/feedCard";
import { deriveCardType, type FeedCardType } from "@/lib/feedCardType";
import { freshnessTimestamp, isRecent } from "@/lib/feedFreshness";
import { leadStat } from "@/lib/leadStat";
import { SECTOR_SHORT, matchPercent, storyTitleAndBrief } from "./swissView";
import { LockedTeaser } from "./LockedTeaser";

// One entry in the ranked stream (left panel). The left is a scannable index;
// reading the full structured briefing happens in the right detail panel
// (scan left / read right). The active row gets a terracotta marker.
//
// Redesign v2: format follows content type. Each row announces its type with
// a branded label, and the *shape* varies by type — image-led rows carry a
// thumbnail, multi-source clusters show a source wall, practitioner briefs
// show discussion volume. The flagship THE CONNECTION is rendered separately
// as a full-width hero; a second image-led story is promoted mid-stream as a
// FeatureExhibit to give the scroll a second peak.

// Native branded types carry the terracotta accent; ingested types stay quiet
// so the editorial signal pops against the news flow.
const ACCENTED_TYPES: ReadonlySet<FeedCardType> = new Set([
  "connection",
  "research",
  "practitioner",
  "tool",
  "earnings",
  "native",
]);

function TypeLabel({
  type,
  label,
  isNew,
}: {
  type: FeedCardType;
  label: string;
  isNew: boolean;
}): JSX.Element {
  const accented = ACCENTED_TYPES.has(type);
  return (
    <div className="mb-1.5 flex items-center gap-2">
      <span
        aria-hidden
        className={clsx(
          "h-2.5 w-2.5 flex-none",
          accented ? "bg-accent" : "border border-ink-muted",
        )}
      />
      <span
        className={clsx(
          "font-mono text-[10px] font-semibold uppercase tracking-[0.2em]",
          accented ? "text-accent" : "text-ink-muted",
        )}
      >
        {label}
      </span>
      {isNew && (
        <span className="bg-accent px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-bg">
          New
        </span>
      )}
    </div>
  );
}

function Kicker({
  rank,
  sector,
  readMinutes,
  sourceCount,
  sourceLabel,
  matchPct,
  typeNote,
}: {
  rank: number;
  sector: string;
  readMinutes: number | null;
  sourceCount: number;
  sourceLabel: string | null;
  matchPct: number;
  typeNote?: JSX.Element | null;
}): JSX.Element {
  const sourceNote =
    !typeNote && sourceCount === 1 && sourceLabel ? `via ${sourceLabel}` : null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">
      <span className="font-semibold text-accent">
        {rank === 1 ? "Rank 1" : String(rank).padStart(2, "0")}
      </span>
      <span className="text-line">{"//"}</span>
      <span className="text-ink-muted">{SECTOR_SHORT[sector] ?? sector}</span>
      {readMinutes != null && <span>· {readMinutes} min read</span>}
      {sourceNote && <span>· {sourceNote}</span>}
      {typeNote && <span>· {typeNote}</span>}
      {rank > 1 && (
        <span className="border border-accent/40 px-1.5 py-0.5 font-semibold text-accent">
          {matchPct}% match
        </span>
      )}
    </div>
  );
}

// Multi-source cluster: a wall of the outlets that covered the event — the
// "+5 outlets" social proof made concrete (stickiness item 1).
function SourceWall({ story }: { story: Story }): JSX.Element | null {
  const names = story.sources
    .map((s) => s.name)
    .filter((n): n is string => Boolean(n))
    .slice(0, 6);
  if (names.length < 2) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted">
      <span className="text-accent">Covered by</span>
      {names.map((n, i) => (
        <span key={n} className="text-ink">
          {n}
          {i < names.length - 1 && <span className="ml-2 text-line">·</span>}
        </span>
      ))}
    </div>
  );
}

function Thumb({ src }: { src: string }): JSX.Element {
  return (
    <div className="hidden h-[88px] w-[88px] flex-none overflow-hidden border border-line bg-ink sm:block md:h-[104px] md:w-[104px]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        className="h-full w-full object-cover opacity-90 transition-transform duration-500 group-hover:scale-[1.04]"
      />
    </div>
  );
}

// Per-type index tile — the imagery fallback for rows with no og:image. A
// typographic/iconographic tile (not fabricated photography) keyed to content
// type, so every row gets a right-side anchor AND the tiles themselves vary by
// type — density without monotony (stickiness item 3, imagery density).
const TYPE_ICON: Record<FeedCardType, LucideIcon> = {
  connection: Network,
  research: GraduationCap,
  practitioner: MessagesSquare,
  tool: Wrench,
  earnings: TrendingUp,
  native: Sparkles,
  cluster: Layers,
  dispatch: Newspaper,
};

// Data-led "one number that mattered" block for the earnings / SEC card. The
// figure is extracted from the commentary text (never fabricated); when the
// copy carries no figure the card just omits this and reads as terse text.
function StatBlock({ stat }: { stat: string }): JSX.Element {
  return (
    <div className="mt-2 inline-flex items-baseline gap-2 border border-accent/40 bg-accent/[0.04] px-3 py-1.5">
      <span className="font-mono text-[22px] font-bold leading-none text-accent">
        {stat}
      </span>
      <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-ink-muted">
        the number that mattered
      </span>
    </div>
  );
}

function TypeTile({
  type,
  sector,
}: {
  type: FeedCardType;
  sector: string;
}): JSX.Element {
  const Icon = TYPE_ICON[type];
  const accented = ACCENTED_TYPES.has(type);
  return (
    <div
      className={clsx(
        "hidden h-[88px] w-[88px] flex-none flex-col items-center justify-center gap-1.5 border md:h-[104px] md:w-[104px] sm:flex",
        accented ? "border-accent/30 bg-accent/[0.04]" : "border-line bg-surface/50",
      )}
    >
      <Icon
        className={clsx("h-6 w-6", accented ? "text-accent" : "text-ink-muted")}
        aria-hidden
      />
      <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-ink-muted">
        {SECTOR_SHORT[sector] ?? sector}
      </span>
    </div>
  );
}

interface StoryExhibitProps {
  story: Story;
  rank: number;
  isActive: boolean;
  onSelect: (storyId: string) => void;
  /** Reader role for the personalized teaser CTA. */
  roleLabel?: string | null;
  /** Client clock for freshness; null during SSR / first paint (no badge). */
  nowMs?: number | null;
  /**
   * Whether to surface the blurred personalized-read teaser. True only for
   * free-tier readers (the conversion hook); Pro / pro_trial get the real
   * read via the lazy commentary path, so the blurred upsell is suppressed.
   */
  showTeaser?: boolean;
}

export function StoryExhibit({
  story,
  rank,
  isActive,
  onSelect,
  roleLabel,
  nowMs,
  showTeaser = false,
}: StoryExhibitProps): JSX.Element {
  const sourceCount = Math.max(1, story.sources.length);
  const matchPct = matchPercent(rank, sourceCount);
  const readMinutes = story.reading_time_minutes ?? null;
  const { title, brief } = storyTitleAndBrief(story);
  const { type, label } = deriveCardType(story);
  const isNew = nowMs != null && isRecent(freshnessTimestamp(story), nowMs);
  const thumb = story.image_url ?? null;
  const teaser =
    showTeaser && story.kind === "ingested"
      ? story.why_it_matters_to_you?.trim() || null
      : null;
  const stat =
    type === "earnings"
      ? leadStat(story.generic_commentary ?? story.why_it_matters)
      : null;

  const typeNote =
    type === "practitioner" && story.comment_count > 0 ? (
      <span className="inline-flex items-center gap-1">
        <MessageSquare className="h-3 w-3" aria-hidden />
        {story.comment_count} discussed
      </span>
    ) : type === "cluster" ? (
      <span className="inline-flex items-center gap-1 text-accent">
        <Layers className="h-3 w-3" aria-hidden />+{sourceCount - 1} more sources
      </span>
    ) : null;

  const headlineSize = rank <= 3 ? "text-[19px] md:text-[21px]" : "text-[17px]";

  return (
    <button
      type="button"
      onClick={() => onSelect(story.id)}
      aria-pressed={isActive}
      className={clsx(
        "group block w-full border-b border-line py-5 text-left transition-colors",
        isActive
          ? "border-l-[3px] border-l-accent bg-accent/[0.05] pl-3"
          : "hover:bg-surface/60",
      )}
    >
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <TypeLabel type={type} label={label} isNew={isNew} />
          <Kicker
            rank={rank}
            sector={story.sector}
            readMinutes={readMinutes}
            sourceCount={sourceCount}
            sourceLabel={sourceDisplayLabel(story)}
            matchPct={matchPct}
            typeNote={typeNote}
          />
          <h3
            className={clsx(
              "mt-2 font-display font-semibold leading-snug transition-colors",
              headlineSize,
              isActive ? "text-accent" : "text-ink group-hover:text-accent",
            )}
          >
            {title}
          </h3>
          {brief && (
            <p
              className="mt-1.5 font-serif text-[14px] italic leading-relaxed text-ink-muted"
              style={{
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {brief}
            </p>
          )}
          {stat && <StatBlock stat={stat} />}
          {type === "cluster" && <SourceWall story={story} />}
          {teaser && <LockedTeaser text={teaser} roleLabel={roleLabel} />}
        </div>
        {thumb ? <Thumb src={thumb} /> : <TypeTile type={type} sector={story.sector} />}
      </div>
    </button>
  );
}

// Second-peak feature (stickiness item 5): an image-led story promoted to a
// wider card mid-stream so the scroll crests again instead of flat-lining into
// a list. Distinct from the THE CONNECTION hero — no chain motif, uses the
// real og:image / illustration, anchored by its branded type label.
export function FeatureExhibit({
  story,
  rank,
  isActive,
  onSelect,
  roleLabel,
  nowMs,
  showTeaser = false,
}: StoryExhibitProps): JSX.Element {
  const sourceCount = Math.max(1, story.sources.length);
  const matchPct = matchPercent(rank, sourceCount);
  const { title, brief } = storyTitleAndBrief(story);
  const { type, label } = deriveCardType(story);
  const isNew = nowMs != null && isRecent(freshnessTimestamp(story), nowMs);
  const art = story.illustration_url ?? story.image_url ?? null;
  const teaser =
    showTeaser && story.kind === "ingested"
      ? story.why_it_matters_to_you?.trim() || null
      : null;

  return (
    <button
      type="button"
      onClick={() => onSelect(story.id)}
      aria-pressed={isActive}
      className={clsx(
        "group my-2 block w-full border text-left transition-colors",
        isActive ? "border-accent bg-accent/[0.06]" : "border-line hover:border-accent",
      )}
    >
      {art && (
        <div className="relative h-[160px] w-full overflow-hidden bg-ink md:h-[190px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={art}
            alt=""
            className="h-full w-full object-cover opacity-90 transition-transform duration-500 group-hover:scale-[1.03]"
          />
          <span className="absolute left-3 top-3 inline-flex items-center gap-2 border border-accent bg-bg/95 px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">
            {label}
            {isNew && <span className="text-ink-muted">· New</span>}
          </span>
        </div>
      )}
      <div className="px-5 py-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">
          <span className="font-semibold text-accent">
            {String(rank).padStart(2, "0")}
          </span>
          <span className="text-line">{"//"}</span>
          <span>{SECTOR_SHORT[story.sector] ?? story.sector}</span>
          <span className="border border-accent/40 px-1.5 py-0.5 font-semibold text-accent">
            {matchPct}% match
          </span>
        </div>
        <h3
          className={clsx(
            "mt-2 font-display text-[20px] font-semibold leading-tight transition-colors md:text-[22px]",
            isActive ? "text-accent" : "text-ink group-hover:text-accent",
          )}
        >
          {title}
        </h3>
        {brief && (
          <p
            className="mt-1.5 font-serif text-[14px] italic leading-relaxed text-ink-muted"
            style={{
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {brief}
          </p>
        )}
        {teaser && <LockedTeaser text={teaser} roleLabel={roleLabel} />}
        <span className="mt-3 inline-flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">
          Open the read
          <ArrowRight
            className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
            aria-hidden
          />
        </span>
      </div>
    </button>
  );
}

// Paywall soft-block as a ranked-stream row. Free-tier stories past the
// daily cap arrive as a gate envelope; we surface the teaser headline and
// route the whole row to the upgrade flow rather than selecting it.
export function GatedExhibit({
  item,
  rank,
}: {
  item: FeedGatedStory;
  rank: number;
}): JSX.Element {
  return (
    <Link
      href="/upgrade"
      className="group block border-b border-line py-5 hover:bg-surface/60 hover:no-underline"
    >
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">
        <span className="font-semibold text-ink-muted">
          {String(rank).padStart(2, "0")}
        </span>
        <span className="text-line">{"//"}</span>
        <Lock className="h-3 w-3 text-accent" aria-hidden />
        <span className="text-accent">Pro</span>
      </div>
      <h3 className="mt-2 font-display text-[18px] font-semibold leading-snug text-ink-muted blur-[1px] transition group-hover:blur-0">
        {item.teaser.headline}
      </h3>
      <p className="mt-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
        {item.upgrade_cta.message}
      </p>
    </Link>
  );
}
