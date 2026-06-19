"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { ROLES } from "@/lib/onboarding";
import { SECTOR_LABEL, sectorColor } from "./swissView";

// The Through-Line hero — the editorial centerpiece of the briefing.
//
// Redesign: the Through-Line is SIGNAL's one real differentiator, but
// shipped as a 26px, unclamped, ~95-word paragraph it became a text wall
// that ate the viewport and buried the feed. It now renders as a MASTHEAD,
// not a reading assignment: a small kicker (which absorbs the edition date
// and hosts refresh), then ONE thesis line (the headline), then one support
// line with a "Read full briefing" expand. Hard-clamped so the block height
// is bounded no matter what the model returns — including legacy
// single-paragraph cache entries written before the two-part prompt.
//
// Wire shape: the service returns two parts separated by a newline (PART 1
// thesis / PART 2 stakes). We split on the newline; when there is none (old
// cache shape) the whole string is the thesis and the 2-line clamp keeps it
// compact. Every tier gets the read; the hero always holds its layout (a
// skeleton while it resolves, a non-null fallback if it comes back empty).

const ROLE_LABEL: Record<string, string> = Object.fromEntries(
  ROLES.map((r) => [r.value, r.label]),
);

const FALLBACK_THESIS =
  "Today's read is being prepared — the evidence is below.";

interface ThroughLineHeroProps {
  throughLine: string | null;
  isLoading: boolean;
  preparedFor: string;
  role: string | null;
  sectors: string[];
  onRefresh: () => void;
  isRefreshing: boolean;
}

function splitThroughLine(text: string): {
  thesis: string;
  support: string | null;
} {
  const parts = text
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) return { thesis: FALLBACK_THESIS, support: null };
  return { thesis: parts[0], support: parts.slice(1).join(" ") || null };
}

export function ThroughLineHero({
  throughLine,
  isLoading,
  preparedFor,
  role,
  sectors,
  onRefresh,
  isRefreshing,
}: ThroughLineHeroProps): JSX.Element {
  const [edition, setEdition] = useState("");
  const [expanded, setExpanded] = useState(false);

  // Edition date computed post-mount to avoid a server/client hydration
  // mismatch on the time-derived value.
  useEffect(() => {
    setEdition(
      new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
      }).format(new Date()),
    );
  }, []);

  const roleLabel = role ? ROLE_LABEL[role] ?? role : null;
  const { thesis, support } = splitThroughLine(throughLine ?? "");
  // Offer the expand when there is a support line, or when the thesis is
  // long enough to be clamped (legacy single-paragraph entries).
  const canExpand =
    throughLine != null && (support != null || thesis.length > 90);

  return (
    <section className="shrink-0 border-b border-line bg-surface px-6 py-4 md:px-8">
      {/* Kicker row — identity stamp (absorbs the date) + refresh */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-ink-muted">
          <span className="font-semibold text-accent">The Through-Line</span>
          {edition && (
            <>
              <span className="text-line">·</span>
              <span>{edition}</span>
            </>
          )}
          <span className="text-line">·</span>
          <span>
            For{" "}
            <span className="font-semibold text-ink">
              {preparedFor.toUpperCase()}
            </span>
          </span>
          {roleLabel && (
            <>
              <span className="text-line">·</span>
              <span>{roleLabel}</span>
            </>
          )}
          {sectors.length > 0 && (
            <>
              <span className="text-line">·</span>
              {sectors.map((s) => (
                <span key={s} style={{ color: sectorColor(s) }}>
                  {SECTOR_LABEL[s] ?? s}
                </span>
              ))}
            </>
          )}
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
          aria-label="Refresh feed"
          className="inline-flex h-6 w-6 flex-none items-center justify-center border border-line text-ink-muted transition-colors hover:border-ink hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw
            className={`h-3 w-3 ${isRefreshing ? "animate-spin" : ""}`}
            aria-hidden
          />
        </button>
      </div>

      {/* The synthesis — thesis-first masthead, bounded height */}
      {isLoading ? (
        <div className="mt-2.5 space-y-2" aria-hidden>
          <div className="skeleton h-7 w-3/4" />
          <div className="skeleton h-4 w-1/2" />
        </div>
      ) : (
        <div className="mt-2.5">
          <p
            className={`max-w-[70ch] font-serif text-[23px] font-medium leading-[1.2] text-ink md:text-[28px] ${
              expanded ? "" : "line-clamp-2"
            }`}
          >
            {thesis}
          </p>
          {support && (
            <p
              className={`mt-1.5 max-w-[70ch] text-[14px] leading-snug text-ink-muted ${
                expanded ? "" : "line-clamp-1"
              }`}
            >
              {support}
            </p>
          )}
          {canExpand && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-accent transition-colors hover:text-accent-hover"
            >
              {expanded ? "Show less ↑" : "Read full briefing ↓"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
