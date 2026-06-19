"use client";

import { ROLES } from "@/lib/onboarding";
import { SECTOR_LABEL, sectorColor } from "./swissView";

// The Through-Line hero — the editorial centerpiece of the briefing.
//
// The switch-up: the Through-Line is SIGNAL's one real differentiator —
// a daily, role-calibrated read of what connects the day's stories — but
// it used to render only as a small figure in the right-panel idle state,
// which vanished the instant a reader opened any story. Most readers never
// saw it. It now LEADS the page as a full-width band above the evidence
// feed, stamped with the reader's identity so "your daily read" is felt,
// not claimed.
//
// Every tier gets the read (the paywall moved to depth + per-story
// commentary + feed breadth). The hero always holds its layout: a skeleton
// while the single Haiku call resolves, and a guaranteed non-null fallback
// line if it returns empty — so it never collapses to zero height above the
// fold, which would read as the product being broken at 7am.

const ROLE_LABEL: Record<string, string> = Object.fromEntries(
  ROLES.map((r) => [r.value, r.label]),
);

// Shown when the synthesis is unavailable (Haiku timed out / Redis off /
// no stories yet). Keeps the hero from collapsing; points the reader at the
// evidence that is present.
const FALLBACK_READ =
  "Today's read is being prepared — the evidence behind it is below.";

interface ThroughLineHeroProps {
  /** The synthesis string, or null when unavailable. */
  throughLine: string | null;
  /** True while the feed or the Through-Line call is still resolving. */
  isLoading: boolean;
  /** Reader display name for the identity stamp. */
  preparedFor: string;
  /** Onboarding role slug, mapped to a human label for the stamp. */
  role: string | null;
  /** Reader's sectors, color-stamped into the byline. */
  sectors: string[];
}

export function ThroughLineHero({
  throughLine,
  isLoading,
  preparedFor,
  role,
  sectors,
}: ThroughLineHeroProps): JSX.Element {
  const roleLabel = role ? ROLE_LABEL[role] ?? role : null;

  return (
    <section className="shrink-0 border-b-2 border-ink bg-bg px-6 pb-6 pt-5 md:px-8">
      {/* Identity stamp — this read is for you, specifically. */}
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[10px] uppercase tracking-[0.2em] text-ink-muted">
        <span className="font-semibold text-accent">The Through-Line</span>
        <span className="text-line">{"//"}</span>
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

      {/* The synthesis — the dominant element on open. Skeleton holds the
          three-line layout so the band never jumps when the text arrives. */}
      {isLoading ? (
        <div className="mt-3 max-w-[68ch] space-y-2.5" aria-hidden>
          <div className="skeleton h-6 w-full" />
          <div className="skeleton h-6 w-11/12" />
          <div className="skeleton h-6 w-2/3" />
        </div>
      ) : (
        <p className="mt-3 max-w-[68ch] font-serif text-[22px] leading-[1.5] text-ink md:text-[26px] md:leading-[1.45]">
          {throughLine ?? FALLBACK_READ}
        </p>
      )}
    </section>
  );
}
