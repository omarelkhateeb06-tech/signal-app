"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { getNativeStoriesRequest } from "@/lib/api";
import { brandLabelForGeneratorType } from "@/lib/feedCard";
import { SECTOR_SHORT, sectorColor } from "./swissView";

// "SIGNAL Originals" — the native editorial posts (cross-sector chains,
// research reads, practitioner briefs, tool spotlights) surfaced as their
// own celebrated band at the top of the ranked stream. This is the
// product's differentiated content — the cross-sector "THE CONNECTION"
// chain in particular is the thing no aggregator produces. Sourced from
// the native archive endpoint so it shows regardless of feed ranking;
// hidden entirely when there are none (or the endpoint is unavailable).

const ORIGINALS_LIMIT = 6;

export function SignalOriginals(): JSX.Element | null {
  const { data } = useQuery({
    queryKey: ["native-originals", ORIGINALS_LIMIT],
    queryFn: () => getNativeStoriesRequest({ limit: ORIGINALS_LIMIT }),
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 1,
  });

  const items = data?.items ?? [];
  if (items.length === 0) return null;

  return (
    <section className="border-b border-line bg-accent/[0.03] px-6 py-6 md:px-8">
      <div className="mb-4 flex items-center gap-2">
        <span aria-hidden className="h-1.5 w-1.5 flex-none bg-accent" />
        <h2 className="font-mono text-[12px] font-semibold uppercase tracking-[0.2em] text-ink">
          Signal Originals
        </h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">
          written by SIGNAL
        </span>
      </div>

      <div className="space-y-4">
        {items.map((item) => {
          const brand = brandLabelForGeneratorType(item.generator_type) ?? "SIGNAL Original";
          return (
            <Link
              key={item.id}
              href={`/stories/${item.id}`}
              className="group block border-l-[3px] border-accent/40 pl-3 transition-colors hover:border-accent hover:no-underline"
            >
              <div className="flex flex-wrap items-center gap-x-2 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-accent">
                {brand}
                <span style={{ color: sectorColor(item.sector) }}>
                  {SECTOR_SHORT[item.sector] ?? item.sector}
                </span>
              </div>
              <h3 className="mt-1 font-display text-[17px] font-semibold leading-snug text-ink transition-colors group-hover:text-accent">
                {item.headline}
              </h3>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
