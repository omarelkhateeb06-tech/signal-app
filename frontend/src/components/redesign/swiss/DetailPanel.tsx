"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Bookmark, Copy } from "lucide-react";
import { useStoryCommentary, type DepthOverride } from "@/hooks/useStoryCommentary";
import { useTier } from "@/hooks/useTier";
import { DepthToggle } from "@/components/stories/DepthToggle";
import { StorySaveButton } from "@/components/stories/StorySaveButton";
import { sourceDisplayLabel } from "@/lib/feedCard";
import { timeAgo } from "@/lib/timeAgo";
import { ROLES } from "@/lib/onboarding";
import { isGatePayload, type Story } from "@/types/story";
import type { UserProfile } from "@/types/auth";
import {
  SECTOR_LABEL,
  fullStoryView,
  indicatorsNote,
  sectorColor,
} from "./swissView";
import { TakeawayList } from "./TakeawayList";
import { toggleSavedTakeaway, useSavedTakeaways } from "./savedTakeaways";

// Right panel. Default state = the reader's intelligence profile, market
// context, and the editorial manifesto. Active state (a story selected on
// the left) = a depth toggle wired to the personalized commentary endpoint
// plus the story's full structured briefing.

const ROLE_LABEL: Record<string, string> = Object.fromEntries(
  ROLES.map((r) => [r.value, r.label]),
);

// Illustrative market context. There is no live market feed yet; these
// signal the *kind* of product SIGNAL is. Clearly marked "indicative".
const MARKET_INDICES: ReadonlyArray<{
  symbol: string;
  label: string;
  value: string;
  delta: string;
  up: boolean;
}> = [
  { symbol: "SOXX", label: "Semis ETF", value: "248.10", delta: "+1.8%", up: true },
  { symbol: "NVDA", label: "Nvidia", value: "1,204.50", delta: "+2.4%", up: true },
  { symbol: "TSM", label: "TSMC ADR", value: "182.30", delta: "+0.9%", up: true },
  { symbol: "ASML", label: "ASML", value: "1,012.70", delta: "-0.6%", up: false },
  { symbol: "AI-LIQ", label: "Compute Liquidity", value: "94.2", delta: "-1.1%", up: false },
];

const MANIFESTO =
  "Artificial intelligence is not a software vertical. It is the substrate the next decade of finance and silicon will be built on — and the people who see the convergence first will own the room.";

function SectionLabel({ children }: { children: string }): JSX.Element {
  return (
    <h4 className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">
      {children} <span className="text-line">{"//"}</span>
    </h4>
  );
}

function ProfileDefault({
  userName,
  profile,
}: {
  userName: string | null;
  profile: UserProfile | null;
}): JSX.Element {
  const role = profile?.role ? ROLE_LABEL[profile.role] ?? profile.role : null;
  const sectors = profile?.sectors ?? [];
  const savedList = [...useSavedTakeaways().values()];
  const [copied, setCopied] = useState(false);

  const handleExport = (): void => {
    if (savedList.length === 0) return;
    const body = savedList.map((e, i) => `${i + 1}. ${e.text}`).join("\n");
    const text = `SIGNAL — Saved Takeaways\n\n${body}\n`;
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard
        .writeText(text)
        .then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        })
        .catch(() => {
          /* clipboard blocked — no-op */
        });
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <SectionLabel>Intelligence Profile</SectionLabel>
        <dl className="mt-3 divide-y divide-line border-y border-line">
          <div className="flex items-baseline justify-between gap-4 py-2.5">
            <dt className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
              Reader
            </dt>
            <dd className="font-display text-[16px] font-semibold text-ink">
              {userName ?? "—"}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4 py-2.5">
            <dt className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
              Role
            </dt>
            <dd className="text-[15px] text-ink">{role ?? "Unspecified"}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4 py-2.5">
            <dt className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
              Sectors
            </dt>
            <dd className="flex flex-wrap justify-end gap-1.5">
              {sectors.length > 0 ? (
                sectors.map((s) => (
                  <span
                    key={s}
                    className="font-mono text-[10px] uppercase tracking-[0.12em]"
                    style={{ color: sectorColor(s) }}
                  >
                    {SECTOR_LABEL[s] ?? s}
                  </span>
                ))
              ) : (
                <span className="text-[15px] text-ink-muted">All</span>
              )}
            </dd>
          </div>
        </dl>
      </div>

      <div>
        <div className="flex items-baseline justify-between">
          <SectionLabel>Saved Takeaways</SectionLabel>
          {savedList.length > 0 && (
            <button
              type="button"
              onClick={handleExport}
              aria-label="Copy all saved takeaways to clipboard"
              className="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.14em] text-accent transition-colors hover:text-accent-hover"
            >
              {copied ? (
                "Copied ✓"
              ) : (
                <>
                  <Copy className="h-3 w-3" aria-hidden />
                  Export {savedList.length}
                </>
              )}
            </button>
          )}
        </div>
        {savedList.length > 0 ? (
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {savedList.map((entry) => (
              <li key={entry.key} className="flex items-start gap-2 py-2.5">
                <Link
                  href={`/stories/${entry.storyId}`}
                  className="flex-1 text-[13px] leading-relaxed text-ink hover:text-accent hover:no-underline"
                >
                  {entry.text}
                </Link>
                <button
                  type="button"
                  onClick={() => toggleSavedTakeaway(entry)}
                  aria-label="Remove saved takeaway"
                  className="mt-[2px] flex-none text-accent"
                >
                  <Bookmark className="h-3.5 w-3.5 fill-current" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 font-sans text-[13px] leading-relaxed text-ink-muted">
            Bookmark a key takeaway in any story and it gets pinned here.
          </p>
        )}
      </div>

      <div>
        <div className="flex items-baseline justify-between">
          <SectionLabel>Market Context</SectionLabel>
          <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-muted">
            indicative
          </span>
        </div>
        <ul className="mt-3 divide-y divide-line border-y border-line">
          {MARKET_INDICES.map((idx) => (
            <li
              key={idx.symbol}
              className="flex items-center justify-between gap-4 py-2.5"
            >
              <div className="min-w-0">
                <span className="font-mono text-[12px] font-semibold tracking-[0.08em] text-ink">
                  {idx.symbol}
                </span>
                <span className="ml-2 text-[12px] text-ink-muted">{idx.label}</span>
              </div>
              <div className="flex items-baseline gap-2 font-mono text-[12px] tabular-nums">
                <span className="text-ink">{idx.value}</span>
                <span style={{ color: idx.up ? "var(--finance)" : "var(--err)" }}>
                  {idx.delta}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <figure className="border-l-[3px] border-accent pl-4">
        <SectionLabel>The Convergence Manifesto</SectionLabel>
        <blockquote className="mt-2 font-serif text-[17px] italic leading-relaxed text-ink">
          “{MANIFESTO}”
        </blockquote>
      </figure>
    </div>
  );
}

function StoryDetail({
  story,
  profile,
  onBack,
}: {
  story: Story;
  profile: UserProfile | null;
  onBack: () => void;
}): JSX.Element {
  const router = useRouter();
  const tierQuery = useTier();
  const isFree = tierQuery.data?.tier === "free";
  const roleLabel = profile?.role ? ROLE_LABEL[profile.role] ?? profile.role : null;

  const [depth, setDepth] = useState<DepthOverride>(
    profile?.depthPreference ?? "accessible",
  );

  // Free users are locked to accessible; never request a gated depth.
  const effectiveDepth: DepthOverride = isFree ? "accessible" : depth;

  // Reset depth to the profile default whenever the selected story changes
  // so a per-story override doesn't silently carry across selections.
  useEffect(() => {
    setDepth(profile?.depthPreference ?? "accessible");
  }, [story.id, profile?.depthPreference]);

  const commentaryQuery = useStoryCommentary(story.id, {
    enabled: true,
    depth: effectiveDepth,
  });
  const envelope = commentaryQuery.data;
  const commentary =
    envelope && !isGatePayload(envelope) ? envelope.commentary : null;

  const view = fullStoryView(story);
  const indicators = indicatorsNote(story);
  const source = sourceDisplayLabel(story);
  const stamp = timeAgo(story.published_at ?? story.created_at);

  // Why-it-matters body: the personalized commentary thesis/support once
  // loaded, falling back to the 12b template floor while it streams in.
  const whyThesis = commentary?.thesis ?? view.whyItMatters;
  const whySupport = commentary?.support ?? null;

  return (
    <div className="space-y-7">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted transition-colors hover:text-ink"
      >
        <ArrowLeft className="h-3 w-3" aria-hidden />
        Back to profile
      </button>

      <div className="flex items-center gap-3 border-b border-line pb-3">
        <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-ink">
          Intel Depth:
        </span>
        <DepthToggle
          value={effectiveDepth}
          onSelect={setDepth}
          lockHigherTiers={isFree}
          onLockedClick={() => router.push("/upgrade")}
        />
      </div>

      {isFree && (
        <Link
          href="/upgrade"
          className="flex items-center justify-between gap-3 border border-accent/30 bg-accent/[0.04] px-3 py-2.5 transition-colors hover:bg-accent/[0.08] hover:no-underline"
        >
          <span className="font-serif text-[13px] italic leading-snug text-ink">
            Read this through your role&apos;s lens — the Briefed &amp; Technical takes are written for {roleLabel ?? "your work"}.
          </span>
          <span className="flex-none font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-accent">
            Unlock Pro →
          </span>
        </Link>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[0.14em]">
        {(story.sector ? [story.sector] : []).map((s) => (
          <span key={s} style={{ color: sectorColor(s) }}>
            {SECTOR_LABEL[s] ?? s}
          </span>
        ))}
      </div>

      <h2 className="font-display text-[30px] font-bold leading-[1.06] tracking-tight text-ink md:text-[34px]">
        {view.title}
      </h2>

      {view.brief && (
        <div>
          <SectionLabel>The Core Brief</SectionLabel>
          <p className="mt-2 max-w-[66ch] text-[15px] leading-[1.85] text-ink">
            {view.brief}
          </p>
        </div>
      )}

      {whyThesis && (
        <div className="border-l-[3px] border-accent bg-accent/[0.06] py-3 pl-4 pr-3">
          <SectionLabel>Why It Matters</SectionLabel>
          <p className="mt-2 max-w-[66ch] font-serif text-[15px] italic leading-[1.8] text-ink">
            {whyThesis}
          </p>
          {whySupport && (
            <p className="mt-3 max-w-[66ch] font-serif text-[14px] italic leading-[1.8] text-ink-muted">
              {whySupport}
            </p>
          )}
          {commentaryQuery.isLoading && (
            <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.16em] text-ink-muted">
              Personalizing…
            </p>
          )}
        </div>
      )}

      {view.takeaways.length > 0 && (
        <div>
          <SectionLabel>Key Takeaways</SectionLabel>
          <TakeawayList storyId={story.id} takeaways={view.takeaways} />
        </div>
      )}

      {indicators && (
        <div>
          <SectionLabel>Indicators to Monitor</SectionLabel>
          <p className="mt-2 font-serif text-[14px] italic leading-relaxed text-ink-muted">
            {indicators}
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted">
        <div className="flex flex-wrap items-center gap-3">
          {source && <span className="text-ink">{source}</span>}
          {stamp && <span>{stamp}</span>}
          {story.sources.length > 1 && (
            <span>{story.sources.length} sources</span>
          )}
        </div>
        <StorySaveButton story={story} />
      </div>
    </div>
  );
}

interface DetailPanelProps {
  selectedStory: Story | null;
  profile: UserProfile | null;
  userName: string | null;
  onBack: () => void;
}

// Presentational only — the responsive container (sticky desktop column vs
// mobile slide-over drawer) is owned by SwissCommandFeed.
export function DetailPanel({
  selectedStory,
  profile,
  userName,
  onBack,
}: DetailPanelProps): JSX.Element {
  return selectedStory ? (
    <StoryDetail story={selectedStory} profile={profile} onBack={onBack} />
  ) : (
    <ProfileDefault userName={userName} profile={profile} />
  );
}
