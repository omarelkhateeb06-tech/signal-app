"use client";

import clsx from "clsx";
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
    <aside className="space-y-6 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">Filters</h2>
        <button
          type="button"
          onClick={onReset}
          className="text-xs text-slate-500 hover:text-slate-900"
        >
          Reset
        </button>
      </div>

      <section className="space-y-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">
          Sector
        </h3>
        <div className="space-y-1">
          {SECTORS.map((sector) => {
            const checked = sectors.includes(sector.value);
            return (
              <label
                key={sector.value}
                className="flex cursor-pointer items-center gap-2 text-sm text-slate-700"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleSector(sector.value)}
                  className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                />
                {sector.label}
              </label>
            );
          })}
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">
          Date range
        </h3>
        <div className="space-y-2">
          <label className="block text-xs text-slate-600">
            From
            <input
              type="date"
              value={fromDate}
              onChange={(e) => onFromDateChange(e.target.value)}
              className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
            />
          </label>
          <label className="block text-xs text-slate-600">
            To
            <input
              type="date"
              value={toDate}
              onChange={(e) => onToDateChange(e.target.value)}
              className="mt-1 block w-full rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
            />
          </label>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">
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
                className={clsx(
                  "rounded-md px-3 py-1 text-left text-sm transition-colors",
                  active
                    ? "bg-violet-50 font-medium text-violet-700"
                    : "text-slate-700 hover:bg-slate-50",
                )}
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
