"use client";

import { ROLES, SECTORS } from "@/lib/onboarding";

// Onboarding payoff — a seeded, role-templated PREVIEW of the daily
// Through-Line, shown on the final screen so the reader feels what their
// role/sector answers buy before they ever reach the feed.
//
// Deliberately an EXAMPLE, not a live synthesis: a brand-new account has no
// profile row and no ranked events yet, and the briefing endpoint needs
// both. Generating a mock client-side keeps the payoff instant and honest
// (it is labelled a preview). The real read lands the next morning from
// that day's stories.

const ROLE_LABEL: Record<string, string> = Object.fromEntries(
  ROLES.map((r) => [r.value, r.label]),
);
const SECTOR_LABEL: Record<string, string> = Object.fromEntries(
  SECTORS.map((s) => [s.value, s.label]),
);

function joinSectors(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "your sectors";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

// Two templates — single-sector vs cross-sector — so the example reflects
// the actual product (the cross-sector connection is the whole point when
// the reader follows more than one sector).
function mockThroughLine(role: string | null, sectors: string[]): string {
  const roleLabel = role ? ROLE_LABEL[role] ?? role : "professionals like you";
  const names = sectors.map((s) => SECTOR_LABEL[s] ?? s);
  const joined = joinSectors(names);

  if (names.length <= 1) {
    return `For ${roleLabel} tracking ${joined}: each morning, the one development that actually moves your work — and the one most people in your role will scroll right past.`;
  }
  return `For ${roleLabel} tracking ${joined}: when a shift in one and a move in another point the same way, the story isn't either alone — it's what they jointly signal for your decisions. That connection is the read you'll get every morning.`;
}

interface OnboardingBriefingPreviewProps {
  role: string | null;
  sectors: string[];
}

export function OnboardingBriefingPreview({
  role,
  sectors,
}: OnboardingBriefingPreviewProps): JSX.Element | null {
  if (sectors.length === 0) return null;

  return (
    <div className="rounded-md border border-line border-l-[3px] border-l-accent bg-accent/[0.05] p-4">
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-accent">
        Your daily read — preview
      </p>
      <p className="mt-2 font-serif text-[17px] italic leading-relaxed text-ink">
        {mockThroughLine(role, sectors)}
      </p>
      <p className="mt-3 text-xs text-ink-muted">
        An example. Your first real Through-Line lands tomorrow morning,
        written from that day&apos;s stories across your sectors.
      </p>
    </div>
  );
}
