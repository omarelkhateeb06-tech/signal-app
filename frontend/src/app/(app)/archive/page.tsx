"use client";

// Phase 12r — SIGNAL native post archive. Newsroom-aesthetic table showing
// all SIGNAL-authored editorial posts (arxiv synthesis, practitioner briefs,
// the connection, tool spotlights) sorted newest first. No images, no
// paywall — the archive is a discovery index, not a detail surface.

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { getNativeStoriesRequest } from "@/lib/api";
import { brandLabelForGeneratorType } from "@/lib/feedCard";
import { timeAgo } from "@/lib/timeAgo";

const SECTOR_LABEL: Record<string, string> = {
  ai: "AI",
  finance: "Finance",
  semiconductors: "Semis",
};

// Large limit so the archive shows all issues on a single page. Adjust
// if the corpus grows large enough to warrant pagination.
const ARCHIVE_LIMIT = 100;

export default function ArchivePage(): JSX.Element {
  const { data, isLoading, error } = useQuery({
    queryKey: ["native-archive"],
    queryFn: () => getNativeStoriesRequest({ limit: ARCHIVE_LIMIT }),
  });

  const items = data?.items ?? [];

  return (
    <div className="space-y-8 pb-16 pt-2">
      {/* ===== Masthead ===== */}
      <header className="border-b-2 border-line pb-4">
        <h1 className="font-display text-[26px] font-semibold leading-none tracking-tight text-ink md:text-[30px]">
          The Archive
        </h1>
        <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-muted">
          SIGNAL editorial — all issues
        </p>
      </header>

      {/* ===== Loading skeleton ===== */}
      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="skeleton h-10 w-full rounded" />
          ))}
        </div>
      )}

      {/* ===== Error ===== */}
      {error && (
        <div className="rounded-md border border-err/40 bg-err/5 p-4 text-sm text-err">
          Failed to load archive. Please try again.
        </div>
      )}

      {/* ===== Empty state ===== */}
      {!isLoading && !error && items.length === 0 && (
        <div className="rounded-lg border border-dashed border-line bg-surface p-12 text-center">
          <p className="font-display text-xl text-ink">No published issues yet.</p>
          <p className="mt-1 text-sm text-ink-muted">
            Check back soon — SIGNAL editorial publishes regularly.
          </p>
        </div>
      )}

      {/* ===== Archive table ===== */}
      {items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b-2 border-line">
                <th className="pb-2 pr-8 text-left font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted">
                  Date
                </th>
                <th className="pb-2 pr-8 text-left font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted">
                  Type
                </th>
                <th className="pb-2 text-left font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted">
                  Headline
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map((item) => {
                const brandLabel = brandLabelForGeneratorType(item.generator_type);
                // For the TYPE column: brand label if available, else
                // fall back to sector abbreviation.
                const typeLabel =
                  brandLabel ?? SECTOR_LABEL[item.sector] ?? item.sector;
                const stamp = timeAgo(item.published_at ?? item.created_at);
                return (
                  <tr key={item.id} className="group transition-colors hover:bg-surface/60">
                    <td className="whitespace-nowrap py-3 pr-8 align-middle font-mono text-[11px] uppercase tracking-wide text-ink-muted">
                      {stamp}
                    </td>
                    <td className="py-3 pr-8 align-middle">
                      <span
                        className="font-mono text-[10px] uppercase tracking-[0.1em]"
                        style={{
                          color: brandLabel
                            ? "var(--accent)"
                            : "var(--ink-muted)",
                        }}
                      >
                        {typeLabel}
                      </span>
                    </td>
                    <td className="py-3 align-middle">
                      <Link
                        href={`/stories/${item.id}`}
                        className="text-sm font-medium text-ink transition-colors hover:text-accent"
                      >
                        {item.headline}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ===== Issue count footer ===== */}
      {items.length > 0 && (
        <div className="flex items-center justify-center gap-3 py-4 font-mono text-[11px] uppercase tracking-wide text-ink-muted">
          <span className="h-px w-8 bg-line" aria-hidden />
          {items.length} {items.length === 1 ? "issue" : "issues"}
          <span className="h-px w-8 bg-line" aria-hidden />
        </div>
      )}
    </div>
  );
}
