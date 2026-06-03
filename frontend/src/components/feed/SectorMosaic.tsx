"use client";

import Link from "next/link";
import { FeatureImage } from "./FeatureImage";
import {
  SectionHeader,
  SectionKicker,
  titleFor,
  type SectionProps,
} from "./sectionShared";
import { timeAgo } from "@/lib/timeAgo";

// Phase 12y — section layout C: one large feature beside a stack of
// thumbnail rows. Distinct from the feature+list layout (which has no
// thumbnails) and the triptych (3 equal). Fills the row on desktop.
export function SectorMosaic({
  sector,
  stories,
}: SectionProps): JSX.Element | null {
  if (stories.length === 0) return null;
  const [big, ...rest] = stories;
  const side = rest.slice(0, 3);
  const { title, dek } = titleFor(big);

  return (
    <section className="space-y-5">
      <SectionHeader sector={sector} count={stories.length} />
      <div className="grid grid-cols-1 gap-x-8 gap-y-6 lg:grid-cols-2">
        <article className="min-w-0">
          <Link
            href={`/stories/${big.id}`}
            className="group block hover:no-underline"
          >
            <FeatureImage
              story={big}
              className="aspect-[16/9] w-full rounded-lg border border-line"
              sizes="(max-width: 1024px) 100vw, 45vw"
            />
            <div className="mt-3">
              <SectionKicker story={big} />
              <h3 className="mt-2 font-display text-[22px] font-bold leading-[1.12] tracking-tight text-ink transition-colors duration-150 group-hover:text-accent">
                {title}
              </h3>
              {dek && (
                <p
                  className="mt-2 text-[14px] leading-relaxed text-ink-muted"
                  style={{
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {dek}
                </p>
              )}
            </div>
          </Link>
        </article>

        {side.length > 0 && (
          <ul className="min-w-0 divide-y divide-line">
            {side.map((s) => {
              const { title: t } = titleFor(s);
              const stamp = timeAgo(s.published_at ?? s.created_at);
              return (
                <li key={s.id}>
                  <Link
                    href={`/stories/${s.id}`}
                    className="group flex gap-4 py-3 first:pt-0 hover:no-underline"
                  >
                    <FeatureImage
                      story={s}
                      className="aspect-square w-24 flex-none rounded-md border border-line"
                      sizes="96px"
                    />
                    <span className="min-w-0">
                      <SectionKicker story={s} />
                      <h4 className="mt-1 font-display text-[15px] font-semibold leading-snug text-ink transition-colors duration-150 group-hover:text-accent">
                        {t}
                      </h4>
                      {stamp && (
                        <span className="mt-1 block font-mono text-[10px] uppercase tracking-wide text-ink-muted">
                          {stamp}
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
