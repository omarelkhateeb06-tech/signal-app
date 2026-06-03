"use client";

import Link from "next/link";
import { Sparkles } from "lucide-react";
import type { Story } from "@/types/story";
import { FeatureImage } from "./FeatureImage";
import { sourceDisplayLabel } from "@/lib/feedCard";
import { timeAgo } from "@/lib/timeAgo";

// Phase 12y — section layout D: VALO Originals (native editorial synthesis).
// An accent-tinted band, illustration-led, distinct from the sourced-news
// sections — it reads as "our own analysis," not a wire feed.
export function ResearchReadBand({
  stories,
}: {
  stories: Story[];
}): JSX.Element | null {
  if (stories.length === 0) return null;
  const [lead, ...rest] = stories;
  const others = rest.slice(0, 3);
  const brand = sourceDisplayLabel(lead) ?? "VALO Original";
  const dek = lead.generic_commentary || lead.why_it_matters_to_you || null;
  const stamp = timeAgo(lead.published_at ?? lead.created_at);

  return (
    <section
      className="rounded-xl border p-6 md:p-8"
      style={{
        background: "color-mix(in srgb, var(--accent) 5%, var(--surface))",
        borderColor: "color-mix(in srgb, var(--accent) 22%, var(--line))",
      }}
    >
      <div className="mb-5 flex items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 text-accent" aria-hidden />
        <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-accent">
          VALO Originals
        </h2>
      </div>

      <div className="grid grid-cols-1 gap-x-8 gap-y-6 lg:grid-cols-[1.3fr_1fr]">
        <article className="min-w-0">
          <Link
            href={`/stories/${lead.id}`}
            className="group block hover:no-underline"
          >
            <FeatureImage
              story={lead}
              className="aspect-[16/9] w-full rounded-lg border border-line"
              sizes="(max-width: 1024px) 100vw, 50vw"
            />
            <div className="mt-3">
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-accent">
                {brand}
              </span>
              <h3 className="mt-2 font-display text-[24px] font-bold leading-[1.12] tracking-tight text-ink transition-colors duration-150 group-hover:text-accent">
                {lead.headline}
              </h3>
              {dek && (
                <p
                  className="mt-2 text-[14px] leading-relaxed text-ink-muted"
                  style={{
                    display: "-webkit-box",
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {dek}
                </p>
              )}
            </div>
          </Link>
          {stamp && (
            <p className="mt-3 font-mono text-[10px] uppercase tracking-wide text-ink-muted">
              {stamp}
            </p>
          )}
        </article>

        {others.length > 0 && (
          <ul className="min-w-0 divide-y divide-line lg:border-l lg:border-line lg:pl-8">
            {others.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/stories/${s.id}`}
                  className="group block py-3 first:pt-0 hover:no-underline"
                >
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-accent">
                    {sourceDisplayLabel(s) ?? "VALO Original"}
                  </span>
                  <h4 className="mt-1 font-display text-[16px] font-semibold leading-snug text-ink transition-colors duration-150 group-hover:text-accent">
                    {s.headline}
                  </h4>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
