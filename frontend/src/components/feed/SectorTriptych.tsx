"use client";

import Link from "next/link";
import { FeatureImage } from "./FeatureImage";
import {
  SectionHeader,
  SectionKicker,
  titleFor,
  type SectionProps,
} from "./sectionShared";

// Phase 12y — section layout B: three equal image-led cards across. A
// structurally distinct shape from the feature+list layout, and it fills
// the full row width (no gaps) on desktop.
export function SectorTriptych({
  sector,
  stories,
}: SectionProps): JSX.Element | null {
  if (stories.length === 0) return null;
  const cards = stories.slice(0, 3);

  return (
    <section className="space-y-5">
      <SectionHeader sector={sector} count={stories.length} />
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((s) => {
          const { title, dek } = titleFor(s);
          return (
            <article key={s.id} className="min-w-0">
              <Link
                href={`/stories/${s.id}`}
                className="group block hover:no-underline"
              >
                <FeatureImage
                  story={s}
                  className="aspect-[16/10] w-full rounded-lg border border-line"
                  sizes="(max-width: 640px) 100vw, 33vw"
                />
                <div className="mt-3">
                  <SectionKicker story={s} />
                  <h3 className="mt-2 font-display text-[18px] font-bold leading-snug text-ink transition-colors duration-150 group-hover:text-accent">
                    {title}
                  </h3>
                  {dek && (
                    <p
                      className="mt-1.5 text-[13px] leading-relaxed text-ink-muted"
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
          );
        })}
      </div>
    </section>
  );
}
