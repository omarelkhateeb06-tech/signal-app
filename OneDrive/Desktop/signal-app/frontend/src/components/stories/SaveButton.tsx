"use client";

import clsx from "clsx";
import { Bookmark, BookmarkCheck } from "lucide-react";

interface SaveButtonProps {
  saved: boolean;
  disabled?: boolean;
  onToggle?: () => void;
  className?: string;
}

export function SaveButton({
  saved,
  disabled,
  onToggle,
  className,
}: SaveButtonProps): JSX.Element {
  const Icon = saved ? BookmarkCheck : Bookmark;
  return (
    <button
      type="button"
      aria-pressed={saved}
      aria-label={saved ? "Unsave story" : "Save story"}
      disabled={disabled}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle?.();
      }}
      className={clsx(
        "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors",
        saved
          ? "border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100"
          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
        disabled && "opacity-50 cursor-not-allowed",
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      <span>{saved ? "Saved" : "Save"}</span>
    </button>
  );
}
