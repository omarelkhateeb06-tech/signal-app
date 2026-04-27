import clsx from "clsx";

const SECTOR_STYLES: Record<string, string> = {
  ai: "bg-violet-100 text-violet-800 border-violet-200",
  finance: "bg-emerald-100 text-emerald-800 border-emerald-200",
  semiconductors: "bg-amber-100 text-amber-800 border-amber-200",
};

const SECTOR_LABELS: Record<string, string> = {
  ai: "AI",
  finance: "Finance",
  semiconductors: "Semiconductors",
};

export function SectorBadge({ sector }: { sector: string }): JSX.Element {
  const style = SECTOR_STYLES[sector] ?? "bg-slate-100 text-slate-800 border-slate-200";
  const label = SECTOR_LABELS[sector] ?? sector;
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        style,
      )}
    >
      {label}
    </span>
  );
}
