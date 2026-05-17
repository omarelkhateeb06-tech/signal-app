"use client";

import { useState } from "react";
import { ExternalLink, Lock, MessageSquare } from "lucide-react";
import { SectorBadge } from "./SectorBadge";
import { StorySaveButton } from "./StorySaveButton";
import { PersonalizationBox } from "./PersonalizationBox";
import { Commentary } from "./Commentary";
import { DepthToggle } from "./DepthToggle";
import { UpgradeCtaButton } from "./UpgradeCta";
import {
  useStoryCommentary,
  type DepthOverride,
} from "@/hooks/useStoryCommentary";
import { useTier } from "@/hooks/useTier";
import { isGatePayload, type Story } from "@/types/story";

function formatDate(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

interface StoryDetailProps {
  story: Story;
}

export function StoryDetail({ story }: StoryDetailProps): JSX.Element {
  const date = formatDate(story.published_at ?? story.created_at);

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
  const serverGate = isGatePayload(commentaryQuery.data) ? commentaryQuery.data : null;

  const resolvedCommentary =
    commentaryQuery.data && !isGatePayload(commentaryQuery.data)
      ? commentaryQuery.data.commentary
      : (story.commentary ?? null);
  const isCommentaryLoading =
    !serverGate &&
    resolvedCommentary === null &&
    commentaryQuery.isFetching;

  return (
    <article className="space-y-6">
      <header className="space-y-4">
        <div className="flex items-center gap-3">
          <SectorBadge sector={story.sector} />
          {date && <span className="text-sm text-slate-500">{date}</span>}
        </div>
        <h1 className="text-3xl font-bold leading-tight text-slate-900">
          {story.headline}
        </h1>
        <div className="flex items-center justify-end">
          <StorySaveButton story={story} />
        </div>
      </header>

      <div className="space-y-3">
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
            commentary render otherwise. */}
        {lockedAttempt || serverGate ? (
          <div className="rounded-md border border-violet-200 bg-violet-50 p-4">
            <div className="mb-3 flex items-start gap-2 text-sm text-violet-900">
              <Lock className="mt-0.5 h-4 w-4 flex-none" aria-hidden />
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
          </div>
        ) : resolvedCommentary ? (
          <Commentary commentary={resolvedCommentary} />
        ) : (
          <PersonalizationBox
            text={story.why_it_matters_to_you}
            loading={isCommentaryLoading}
          />
        )}
      </div>

      {/*
        Phase 12e.7b — discrete coverage list for multi-source events.
        Single-source stories keep the existing footer attribution; only
        multi-source items render this section. Primary source carries a
        small badge so the relationship to the footer link is explicit.
      */}
      {story.sources.length > 1 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            Coverage
          </h2>
          <ul className="space-y-1">
            {story.sources.map((s) => (
              <li key={s.url} className="flex items-center gap-2 text-sm">
                {s.role === "primary" && (
                  <span className="rounded bg-violet-100 px-1.5 py-0.5 text-xs font-medium text-violet-700">
                    Primary
                  </span>
                )}
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-slate-600 hover:text-violet-700 hover:underline"
                >
                  {s.name ?? s.url}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-4">
        <div>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-700">
            From the source
          </h2>
          <p className="whitespace-pre-line text-base leading-relaxed text-slate-800">
            {story.context}
          </p>
        </div>
      </section>

      <footer className="flex items-center justify-between border-t border-slate-200 pt-4 text-sm text-slate-500">
        <span className="inline-flex items-center gap-1">
          <MessageSquare className="h-4 w-4" />
          {story.comment_count} comments
        </span>
        {story.source_url && (
          <div className="flex flex-col items-end gap-1">
            <a
              href={story.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-slate-600 hover:text-violet-700"
            >
              {story.source_name ?? "Read source"}
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
            {story.sources.length > 1 && (
              <span className="text-xs text-slate-400">
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
