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
          "rounded-full border px-3 py-1 font-mono text-[11px] uppercase tracking-[0.1em] transition-colors",
          selected.length === 0
            ? "border-accent bg-accent text-accent-fg"
            : "border-line bg-surface text-ink-muted hover:border-ink-muted hover:text-ink",
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
              "rounded-full border px-3 py-1 font-mono text-[11px] uppercase tracking-[0.1em] transition-colors",
              active
                ? "border-accent bg-accent text-accent-fg"
                : "border-line bg-surface text-ink-muted hover:border-ink-muted hover:text-ink",
            )}
          >
            {sector.label}
          </button>
        );
      })}
    </div>
  );
}
