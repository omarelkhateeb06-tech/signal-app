"use client";

import { useState } from "react";
import Image from "next/image";
import { ExternalLink, Lock, MessageSquare } from "lucide-react";
import { SectorBadge } from "./SectorBadge";
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
import { isGatePayload, type Story } from "@/types/story";

interface StoryDetailProps {
  story: Story;
}

// Phase 12j — story detail surface restyle. Header → meta row →
// depth toggle → commentary (with inline depth-gate prompt) →
// optional coverage section → "From the source" body → footer with
// source link + comment-count.

export function StoryDetail({ story }: StoryDetailProps): JSX.Element {
  const stamp = timeAgo(story.published_at ?? story.created_at);

  // Phase 12g — tier drives the depth-toggle lock + the inline upgrade
  // prompt for free users who click a locked tier.
  const tierQuery = useTier();
  const isFree = tierQuery.data?.tier === "free";
  const trialAvailable = tierQuery.data?.trial_available ?? false;

  // Depth toggle state — defaults to accessible. Free users tapping
  // briefed/technical never reach onSelect; they go through
  // onLockedClick which sets a sticky inline-upgrade flag instead.
  const [depth, setDepth] = useState<DepthOverride>("accessible");
  const [lockedAttempt, setLockedAttempt] = useState<DepthOverride | null>(null);

  const commentaryQuery = useStoryCommentary(story.id, {
    enabled: true,
    depth,
  });

  // Defensive: if the server ever returns a depth-gate envelope on
  // this path (shouldn't if the toggle blocks free clicks, but a
  // direct API caller or an out-of-sync client could trigger it), we
  // surface the inline prompt rather than rendering empty commentary.
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

  return (
    <article className="space-y-7">
      {/* Phase 12k — hero image above the headline when an og:image is
          available. Full-width, capped at ~300px tall, object-cover. No
          placeholder when image_url is null — the article opens with the
          headline as it did pre-12k. */}
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
      <header className="space-y-4">
        <h1 className="font-display text-[28px] font-semibold leading-tight text-ink md:text-[30px]">
          {story.headline}
        </h1>
        {/* Meta row: sector · timestamp · save. Same bottom-row pattern
            as the feed card so the user re-orients fast. */}
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-ink-muted">
          <div className="flex items-center gap-3">
            <SectorBadge sector={story.sector} />
            {stamp && (
              <span className="font-mono text-[11px] tracking-tight">{stamp}</span>
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

      <div className="space-y-4">
        <DepthToggle
          value={depth}
          onSelect={(d) => {
            setLockedAttempt(null);
            setDepth(d);
          }}
          lockHigherTiers={isFree}
          onLockedClick={(d) => setLockedAttempt(d)}
        />

        {/* Phase 12g — inline upgrade prompt when a free user clicks a
            locked depth tier OR if a server-side depth gate envelope
            slips through (defensive). Falls through to the normal
            commentary render otherwise. The prompt uses an accent-
            tinted Card body so the spatial context stays intact —
            commentary renders here on the un-gated path. */}
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
      </div>

      {/* Phase 12e.7b — coverage list for multi-source events. Single-
          source stories keep the existing footer attribution; only
          multi-source items render this section. */}
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

      <section className="space-y-3">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted">
          From the source
        </h2>
        {/* Phase 12e.x fix cluster — body extractor stores readability-
            parsed HTML. SourceBody runs the content through DOMPurify
            with a tight tag allowlist + .source-body styling so the
            prose reads as editorial content. Feed previews keep using
            plain text (commentary thesis) — only the detail surface
            renders structured HTML. */}
        <SourceBody html={story.context} />
      </section>

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
