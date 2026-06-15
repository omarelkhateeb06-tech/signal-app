"use client";

import Link from "next/link";
import { useInFocus } from "@/hooks/useInFocus";

// "In Focus" — the most frequent topics across recent events (Bloomberg's
// ongoing-story anchors). Topics come from the LLM topic-extraction job
// (events.topics), aggregated by GET /api/v1/stories/in-focus. Each chip links
// to a search for that topic. Renders nothing until topics exist, so the bar
// stays invisible before the extraction backfill has run (no empty shell).
export function InFocusBar(): JSX.Element | null {
  const { data: topics } = useInFocus();
  if (!topics || topics.length === 0) return null;

  return (
    <div className="mb-4 border-b border-line pb-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-accent">
          In Focus
        </span>
        {topics.map((t) => (
          <Link
            key={t.topic}
            href={`/search?q=${encodeURIComponent(t.topic)}`}
            className="inline-flex items-center gap-1 border border-line px-2 py-0.5 font-mono text-[11px] text-ink-muted transition-colors hover:border-accent hover:text-accent hover:no-underline"
          >
            {t.topic}
            <span className="text-[9px] text-line">{t.count}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
