"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";

// The briefing nameplate. Phase 12x — compacted from the prior newspaper-
// cosplay masthead (Vol. IV // Issue N, "Published 05:00 UTC", a Tracked-
// sectors line) down to the wordmark + a "prepared for / edition" line +
// refresh + settings, so the CONNECTION hero and first headlines lead the
// screen instead of sitting six chrome bands down. The "Tracked: <sectors>"
// line was dropped as redundant with the sector filter directly below. The
// edition date is computed post-mount to avoid a server/client hydration
// mismatch on the time-derived value.

interface SwissMastheadProps {
  preparedFor: string;
  onRefresh: () => void;
  isRefreshing: boolean;
}

export function SwissMasthead({
  preparedFor,
  onRefresh,
  isRefreshing,
}: SwissMastheadProps): JSX.Element {
  const [edition, setEdition] = useState("");

  useEffect(() => {
    setEdition(
      new Intl.DateTimeFormat("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      }).format(new Date()),
    );
  }, []);

  return (
    <header className="shrink-0 border-b-2 border-ink px-6 pb-4 pt-5 md:px-10">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div>
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.28em] text-accent">
            Daily Intelligence Briefing
          </p>
          <h1 className="mt-1 font-display text-[44px] font-black leading-[0.85] tracking-tight text-ink md:text-[60px]">
            SIGNAL
          </h1>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex flex-col items-start gap-0.5 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-muted md:items-end">
            <span>
              Prepared for{" "}
              <span className="font-semibold text-ink underline decoration-accent decoration-2 underline-offset-2">
                {preparedFor.toUpperCase()}
              </span>
            </span>
            <span>{edition || "—"}</span>
          </div>
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
            Settings
          </Link>
        </div>
      </div>
    </header>
  );
}
