"use client";

import { SECTORS } from "@/lib/onboarding";
import type { SearchSort } from "@/types/story";

interface SearchFiltersProps {
  sectors: string[];
  onSectorsChange: (next: string[]) => void;
  fromDate: string;
  onFromDateChange: (next: string) => void;
  toDate: string;
  onToDateChange: (next: string) => void;
  sort: SearchSort;
  onSortChange: (next: SearchSort) => void;
  onReset: () => void;
}

const SORT_OPTIONS: ReadonlyArray<{ value: SearchSort; label: string }> = [
  { value: "relevance", label: "Relevance" },
  { value: "newest", label: "Newest" },
  { value: "most_saved", label: "Most saved" },
];

export function SearchFilters(props: SearchFiltersProps): JSX.Element {
  const {
    sectors,
    onSectorsChange,
    fromDate,
    onFromDateChange,
    toDate,
    onToDateChange,
    sort,
    onSortChange,
    onReset,
  } = props;

  const toggleSector = (value: string): void => {
    if (sectors.includes(value)) {
      onSectorsChange(sectors.filter((s) => s !== value));
    } else {
      onSectorsChange([...sectors, value]);
    }
  };

  return (
    <aside className="space-y-6 rounded-md border border-line bg-surface p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">Filters</h2>
        <button
          type="button"
          onClick={onReset}
          className="text-xs text-ink-muted transition-colors hover:text-ink"
        >
          Reset
        </button>
      </div>

      <section className="space-y-2">
        <h3 className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted">
          Sector
        </h3>
        <div className="space-y-1">
          {SECTORS.map((sector) => {
            const checked = sectors.includes(sector.value);
            return (
              <label
                key={sector.value}
                className="flex cursor-pointer items-center gap-2 text-sm text-ink"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleSector(sector.value)}
                  className="h-4 w-4 rounded border-line text-accent focus:ring-accent"
                />
                {sector.label}
              </label>
            );
          })}
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted">
          Date range
        </h3>
        <div className="space-y-2">
          <label className="block text-xs text-ink-muted">
            From
            <input
              type="date"
              value={fromDate}
              onChange={(e) => onFromDateChange(e.target.value)}
              className="mt-1 block w-full rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
            />
          </label>
          <label className="block text-xs text-ink-muted">
            To
            <input
              type="date"
              value={toDate}
              onChange={(e) => onToDateChange(e.target.value)}
              className="mt-1 block w-full rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
            />
          </label>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted">
          Sort by
        </h3>
        <div className="flex flex-col gap-1">
          {SORT_OPTIONS.map((option) => {
            const active = sort === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onSortChange(option.value)}
                className={[
                  "rounded-md px-3 py-1 text-left text-sm transition-colors",
                  active
                    ? "font-medium text-accent"
                    : "text-ink-muted hover:bg-bg hover:text-ink",
                ].join(" ")}
                style={
                  active
                    ? {
                        backgroundColor:
                          "color-mix(in srgb, var(--accent) 8%, transparent)",
                      }
                    : undefined
                }
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </section>
    </aside>
  );
}
