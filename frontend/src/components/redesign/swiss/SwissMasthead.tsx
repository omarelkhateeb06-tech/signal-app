"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";

// The briefing nameplate — collapsed to a thin status strip.
//
// The Through-Line hero now leads the page and carries the reader's
// identity stamp ("For OMAR · Engineer · AI"), so the masthead sheds the
// newspaper-costume chrome it used to wear — the 60px wordmark, the "Daily
// Intelligence Briefing" overline, the "Prepared for / edition" block — down
// to a single line: a small wordmark, the edition date, refresh, and a
// settings link. This is the read-leads-the-page hierarchy at the pixel
// level: the chrome gets out of the way of the synthesis.
//
// The edition date is computed post-mount to avoid a server/client
// hydration mismatch on the time-derived value.

interface SwissMastheadProps {
  onRefresh: () => void;
  isRefreshing: boolean;
}

export function SwissMasthead({
  onRefresh,
  isRefreshing,
}: SwissMastheadProps): JSX.Element {
  const [edition, setEdition] = useState("");

  useEffect(() => {
    setEdition(
      new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(new Date()),
    );
  }, []);

  return (
    <header className="flex shrink-0 items-center justify-between gap-4 border-b border-line px-6 py-2.5 md:px-8">
      <div className="flex items-baseline gap-3">
        <span className="font-display text-[18px] font-black leading-none tracking-tight text-ink">
          SIGNAL
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted">
          {edition || "—"}
        </span>
      </div>

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
          Settings
        </Link>
      </div>
    </header>
  );
}
