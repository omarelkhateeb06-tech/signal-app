"use client";

import Link from "next/link";
import { Clock } from "lucide-react";
import type { Story } from "@/types/story";
import { SectionKicker, titleFor } from "./sectionShared";
import { timeAgo } from "@/lib/timeAgo";

// Phase 12y — section layout E: "Latest" — a dense, timestamped, image-less
// multi-column list. A deliberately different TEXTURE from the image cards
// (a wire-ticker feel), adding rhythm and packing the page tightly.
export function LatestStrip({
  stories,
}: {
  stories: Story[];
}): JSX.Element | null {
  if (stories.length === 0) return null;

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <Clock className="h-3.5 w-3.5 text-accent" aria-hidden />
        <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-ink">
          Latest
        </h2>
        <span className="h-px flex-1 bg-line" aria-hidden />
      </div>

      <ul className="grid grid-cols-1 gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
        {stories.map((s) => {
          const { title } = titleFor(s);
          const stamp = timeAgo(s.published_at ?? s.created_at);
          return (
            <li key={s.id} className="border-t border-line">
              <Link
                href={`/stories/${s.id}`}
                className="group flex gap-3 py-3 hover:no-underline"
              >
                <span className="w-12 flex-none pt-0.5 font-mono text-[10px] uppercase tracking-wide text-ink-muted">
                  {stamp}
                </span>
                <span className="min-w-0">
                  <h4 className="font-display text-[15px] font-semibold leading-snug text-ink transition-colors duration-150 group-hover:text-accent">
                    {title}
                  </h4>
                  <span className="mt-1 block">
                    <SectionKicker story={s} />
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
