"use client";

import { useState } from "react";
import Image from "next/image";
import { ExternalLink, Lock, MessageSquare } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { StorySaveButton } from "./StorySaveButton";
import { PersonalizationBox } from "./PersonalizationBox";
import { Commentary } from "./Commentary";
import { DepthToggle } from "./DepthToggle";
import { SourceBody } from "./SourceBody";
import { UpgradeCtaButton } from "./UpgradeCta";
import { Card } from "@/components/ui/Card";
import {
  useStoryCommentary,
  type DepthOverride,
} from "@/hooks/useStoryCommentary";
import { useTier } from "@/hooks/useTier";
import { timeAgo } from "@/lib/timeAgo";
import { isNativeStory, sourceDisplayLabel } from "@/lib/feedCard";
import { isGatePayload, type Story } from "@/types/story";

interface StoryDetailProps {
  story: Story;
}

const SECTOR_VAR: Record<string, string> = {
  ai: "var(--ai)",
  finance: "var(--finance)",
  semiconductors: "var(--semis)",
};

const SECTOR_LABEL: Record<string, string> = {
  ai: "Artificial Intelligence",
  finance: "Finance",
  semiconductors: "Semiconductors",
};

export function StoryDetail({ story }: StoryDetailProps): JSX.Element {
  // Phase 12r — distinguish native (SIGNAL-authored) from ingested posts.
  // Native posts get a brand label kicker, a synthesis hero body, and no
  // "From the source" section (their `context` is useless metadata).
  const native = isNativeStory(story);
  const sourceLabel = sourceDisplayLabel(story);

  const stamp = timeAgo(story.published_at ?? story.created_at);

  const tierQuery = useTier();
  const isFree = tierQuery.data?.tier === "free";
  const trialAvailable = tierQuery.data?.trial_available ?? false;

  const [depth, setDepth] = useState<DepthOverride>("accessible");
  const [lockedAttempt, setLockedAttempt] = useState<DepthOverride | null>(null);

  const commentaryQuery = useStoryCommentary(story.id, {
    enabled: true,
    depth,
  });

  const serverGate = isGatePayload(commentaryQuery.data)
    ? commentaryQuery.data
    : null;

  const resolvedCommentary =
    commentaryQuery.data && !isGatePayload(commentaryQuery.data)
      ? commentaryQuery.data.commentary
      : (story.commentary ?? null);
  const isCommentaryLoading =
    !serverGate &&
    resolvedCommentary === null &&
    commentaryQuery.isFetching;

  // Key for AnimatePresence — changes whenever visible content changes.
  const commentaryKey = resolvedCommentary?.thesis?.slice(0, 30) ?? `${depth}-loading`;

  return (
    <article className="space-y-7">
      {story.image_url && (
        <div className="relative -mx-1 overflow-hidden rounded-lg" style={{ maxHeight: 300 }}>
          <Image
            src={story.image_url}
            alt=""
            width={1200}
            height={600}
            unoptimized
            loading="lazy"
            className="h-auto w-full object-cover"
            style={{ maxHeight: 300 }}
          />
        </div>
      )}
      {/* Phase 12s — native illustration hero. Native posts carry no
          scraped og:image; their editorial illustration serves as the
          hero. 16:9, object-cover, alt from the headline. Gated on
          !image_url so a native post that somehow has both never renders
          two heroes (og:image wins). */}
      {native && story.illustration_url && !story.image_url && (
        <div className="relative -mx-1 overflow-hidden rounded-lg border border-line">
          <div className="aspect-[16/9] w-full">
            <Image
              src={story.illustration_url}
              alt={story.headline}
              fill
              unoptimized
              loading="lazy"
              sizes="(max-width: 768px) 100vw, 720px"
              className="object-cover"
            />
          </div>
        </div>
      )}
      <header className="space-y-4">
        {/* Sector kicker + source dateline — same editorial language as
            the feed lead, so the click-through feels continuous. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span
            className="inline-flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.14em]"
            style={{ color: SECTOR_VAR[story.sector] ?? "var(--ink-muted)" }}
          >
            <span
              aria-hidden
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: SECTOR_VAR[story.sector] ?? "var(--ink-muted)" }}
            />
            {SECTOR_LABEL[story.sector] ?? story.sector}
          </span>
          {/* Phase 12r — native posts show a brand label (no "via" prefix);
              ingested posts keep the "via {source}" attribution style. */}
          {sourceLabel && (
            <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink-muted">
              {native ? sourceLabel : `via ${sourceLabel}`}
            </span>
          )}
        </div>

        <h1 className="font-display text-[32px] font-semibold leading-[1.12] tracking-tight text-ink md:text-[38px]">
          {story.headline}
        </h1>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 text-xs text-ink-muted">
          <div className="flex items-center gap-4">
            {stamp && (
              <span className="font-mono text-[11px] uppercase tracking-wide">{stamp}</span>
            )}
            {story.reading_time_minutes != null && (
              <span className="font-mono text-[11px] uppercase tracking-wide">
                {story.reading_time_minutes} min read
              </span>
            )}
            {story.comment_count > 0 && (
              <span className="inline-flex items-center gap-1">
                <MessageSquare className="h-3.5 w-3.5" />
                {story.comment_count}
              </span>
            )}
          </div>
          <StorySaveButton story={story} />
        </div>
      </header>

      {/* Phase 12r — synthesis hero for native posts. `generic_commentary`
          holds the full 200-word editorial paragraph (accessible.thesis +
          accessible.support from the tier generation chain). Displayed as
          the primary body text above the "Why it matters" section. Hidden
          for ingested posts where generic_commentary is a role-neutral
          hook/teaser, not a long-form synthesis. */}
      {native && story.generic_commentary && (
        <section
          className="space-y-2 border-l-[3px] pl-4"
          style={{ borderColor: "var(--accent)" }}
        >
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-accent">
            The synthesis
          </p>
          <p className="text-[15px] leading-[1.75] text-ink">
            {story.generic_commentary}
          </p>
        </section>
      )}

      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-accent">
            Why it matters to you
          </p>
          <DepthToggle
            value={depth}
            onSelect={(d) => {
              setLockedAttempt(null);
              setDepth(d);
            }}
            lockHigherTiers={isFree}
            onLockedClick={(d) => setLockedAttempt(d)}
          />
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={lockedAttempt ?? serverGate ? "gate" : commentaryKey}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15, ease: "easeInOut" }}
          >
            {lockedAttempt || serverGate ? (
              <Card
                flat
                className="p-5"
                style={{
                  backgroundColor:
                    "color-mix(in srgb, var(--accent) 6%, var(--surface))",
                  borderColor:
                    "color-mix(in srgb, var(--accent) 25%, var(--line))",
                }}
              >
                <div className="mb-3 flex items-start gap-2 text-sm text-ink">
                  <Lock className="mt-0.5 h-4 w-4 flex-none text-accent" aria-hidden />
                  <span>
                    {serverGate?.upgrade_cta.message ??
                      (trialAvailable
                        ? "Get commentary tailored to your role. Try Pro free for 7 days."
                        : "Upgrade to Pro — $10/month")}
                  </span>
                </div>
                <UpgradeCtaButton
                  cta={
                    serverGate?.upgrade_cta ?? {
                      trial_available: trialAvailable,
                      message: "",
                    }
                  }
                />
              </Card>
            ) : resolvedCommentary ? (
              <Commentary commentary={resolvedCommentary} />
            ) : (
              <PersonalizationBox
                text={story.why_it_matters_to_you}
                loading={isCommentaryLoading}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {story.sources.length > 1 && (
        <section className="space-y-2">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted">
            Coverage
          </h2>
          <ul className="space-y-1">
            {story.sources.map((s) => (
              <li key={s.url} className="flex items-center gap-2 text-sm">
                {s.role === "primary" && (
                  <span
                    className="rounded-sm px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent"
                    style={{
                      backgroundColor:
                        "color-mix(in srgb, var(--accent) 12%, transparent)",
                    }}
                  >
                    Primary
                  </span>
                )}
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-ink-muted hover:text-accent hover:underline"
                >
                  {s.name ?? s.url}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Phase 12r — "From the source" section is suppressed for native
          posts: their `context` field holds useless metadata strings (e.g.
          "Weekly arXiv synthesis — 3 ai paper(s), 2026-W22") rather than
          article body HTML. Only rendered for ingested posts. */}
      {!native && (
        <section className="space-y-3">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted">
            From the source
          </h2>
          <SourceBody html={story.context} />
        </section>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 text-sm text-ink-muted">
        <span className="inline-flex items-center gap-1">
          <MessageSquare className="h-4 w-4" />
          {story.comment_count} {story.comment_count === 1 ? "comment" : "comments"}
        </span>
        {story.source_url && (
          <div className="flex flex-col items-end gap-1">
            <a
              href={story.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-ink-muted transition-colors hover:text-accent"
            >
              {story.source_name ?? "Read source"}
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
            {story.sources.length > 1 && (
              <span className="text-xs text-ink-muted/80">
                Also covered by{" "}
                {story.sources
                  .filter((s) => s.role === "alternate")
                  .map((s) => s.name ?? "unknown")
                  .join(", ")}
              </span>
            )}
          </div>
        )}
      </footer>
    </article>
  );
}
