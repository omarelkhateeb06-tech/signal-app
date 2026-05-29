"use client";

import { useEffect, useRef } from "react";
import { motion, useAnimation } from "framer-motion";
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
  const controls = useAnimation();
  const prevSaved = useRef(saved);

  useEffect(() => {
    if (!prevSaved.current && saved) {
      // Saved: spring bounce
      void controls.start({
        scale: [1, 1.25, 0.95, 1],
        transition: { duration: 0.3, ease: "easeOut" },
      });
    } else if (prevSaved.current && !saved) {
      // Unsaved: simple fade-through
      void controls.start({
        opacity: [1, 0.4, 1],
        transition: { duration: 0.2, ease: "easeInOut" },
      });
    }
    prevSaved.current = saved;
  }, [saved, controls]);

  return (
    <motion.button
      type="button"
      aria-pressed={saved}
      aria-label={saved ? "Unsave story" : "Save story"}
      disabled={disabled}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle?.();
      }}
      animate={controls}
      style={
        saved
          ? {
              backgroundColor: "color-mix(in srgb, var(--accent) 9%, var(--surface))",
              borderColor: "color-mix(in srgb, var(--accent) 32%, var(--line))",
              color: "var(--accent)",
            }
          : undefined
      }
      className={clsx(
        "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors",
        saved
          ? ""
          : "border-line bg-surface text-ink-muted hover:border-ink-muted hover:text-ink",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      <span>{saved ? "Saved" : "Save"}</span>
    </motion.button>
  );
}
