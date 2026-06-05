"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";

// The briefing nameplate. Massive serif "SIGNAL" wordmark, mono edition
// metadata, and a tracked-sectors / re-calibrate line. The date + issue
// number are computed client-side (post-mount) to avoid a server/client
// hydration mismatch on the time-derived values.

interface SwissMastheadProps {
  preparedFor: string;
  sectors: string[];
  onRefresh: () => void;
  isRefreshing: boolean;
}

const SECTOR_DISPLAY: Record<string, string> = {
  ai: "AI",
  finance: "FINANCE",
  semiconductors: "SEMICONDUCTORS",
};

function dayOfYear(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 0);
  const diff = d.getTime() - start.getTime();
  return Math.floor(diff / 86_400_000);
}

export function SwissMasthead({
  preparedFor,
  sectors,
  onRefresh,
  isRefreshing,
}: SwissMastheadProps): JSX.Element {
  const [edition, setEdition] = useState("");
  const [issue, setIssue] = useState<number | null>(null);

  useEffect(() => {
    const now = new Date();
    setEdition(
      new Intl.DateTimeFormat("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      }).format(now),
    );
    setIssue(dayOfYear(now));
  }, []);

  const tracked =
    sectors.length > 0
      ? sectors.map((s) => SECTOR_DISPLAY[s] ?? s.toUpperCase()).join(" · ")
      : "AI · SEMICONDUCTORS · FINANCE";

  return (
    <header className="shrink-0 border-b-2 border-ink px-6 pb-5 pt-6 md:px-10">
      <p className="font-mono text-[11px] font-medium uppercase tracking-[0.28em] text-accent">
        Daily Intelligence Briefing
      </p>

      <div className="mt-2 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <h1 className="font-display text-[52px] font-black leading-[0.85] tracking-tight text-ink md:text-[72px]">
          SIGNAL
        </h1>

        <div className="flex flex-col items-start gap-0.5 font-mono text-[11px] uppercase leading-relaxed tracking-[0.16em] text-ink-muted md:items-end">
          <span>
            Edition:{" "}
            <span className="text-ink">{edition || "—"}</span>
          </span>
          <span>Published: 05:00 UTC</span>
          <span>
            Prepared for:{" "}
            <span className="font-semibold text-ink underline decoration-accent decoration-2 underline-offset-2">
              {preparedFor.toUpperCase()}
            </span>
          </span>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-line pt-3">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-muted">
          Vol. IV // Issue {issue ?? "—"}
          <span className="mx-2 text-line">|</span>
          Tracked: <span className="text-ink">{tracked}</span>
        </p>

        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            aria-label="Refresh feed"
            className="inline-flex h-7 w-7 flex-none items-center justify-center border border-line text-ink-muted transition-colors hover:border-ink hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`}
              aria-hidden
            />
          </button>
          <Link
            href="/settings"
            className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-accent hover:text-accent-hover hover:no-underline"
          >
            [Re-Calibrate Feed Profile]
          </Link>
        </div>
      </div>
    </header>
  );
}
