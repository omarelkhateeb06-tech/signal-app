"use client";

import clsx from "clsx";
import { SECTORS } from "@/lib/onboarding";

interface SectorFilterProps {
  selected: string[];
  onChange: (next: string[]) => void;
}

export function SectorFilter({ selected, onChange }: SectorFilterProps): JSX.Element {
  const toggle = (value: string): void => {
    if (selected.includes(value)) {
      onChange(selected.filter((s) => s !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => onChange([])}
        className={clsx(
          "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
          selected.length === 0
            ? "border-slate-900 bg-slate-900 text-white"
            : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
        )}
      >
        All
      </button>
      {SECTORS.map((sector) => {
        const active = selected.includes(sector.value);
        return (
          <button
            key={sector.value}
            type="button"
            onClick={() => toggle(sector.value)}
            className={clsx(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              active
                ? "border-violet-600 bg-violet-600 text-white"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
            )}
          >
            {sector.label}
          </button>
        );
      })}
    </div>
  );
}
