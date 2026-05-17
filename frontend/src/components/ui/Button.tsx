"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";

// Phase 12j — Button primitive. Three variants matching the design
// brief: primary (accent fill), secondary (outline), ghost (text only).
// Three sizes (sm / md / lg). All variants share a soft-out cubic-
// bezier transition for hover + press.

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-accent-fg hover:bg-accent-hover active:translate-y-px",
  secondary:
    "bg-surface text-ink border border-line hover:border-ink-muted hover:bg-bg",
  ghost: "bg-transparent text-ink hover:bg-line/60",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", className, type, ...rest },
  ref,
) {
  const cls = [
    "inline-flex items-center justify-center gap-2 rounded-md font-medium",
    "transition-all duration-150 ease-soft-out",
    "disabled:cursor-not-allowed disabled:opacity-50",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
    VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return <button ref={ref} type={type ?? "button"} className={cls} {...rest} />;
});
