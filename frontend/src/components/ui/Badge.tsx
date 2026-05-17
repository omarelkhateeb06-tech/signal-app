"use client";

import { type HTMLAttributes } from "react";

// Phase 12j — Badge primitive. Pill-shaped small label. Used for
// sector indicators, tier chips, trial-day countdowns, source-count
// chips. Sector variants render as a filled pill in the sector accent
// color; neutral/accent/warn variants are for non-sector usage.

export type BadgeTone =
  | "neutral"
  | "accent"
  | "warn"
  | "ok"
  | "ai"
  | "finance"
  | "semis";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  // Use the bg-tinted variant (subtle, low-saturation) instead of the
  // filled-color variant (high contrast). Filled is the default for
  // sectors; tinted is the default for neutral chrome.
  variant?: "filled" | "tinted";
}

// color-mix gives us low-saturation tints from the same source token
// — keeps the palette tight even for the tinted variants.
const TONE_FILLED: Record<BadgeTone, string> = {
  neutral: "bg-ink-muted text-bg",
  accent: "bg-accent text-accent-fg",
  warn: "bg-warn text-bg",
  ok: "bg-ok text-bg",
  ai: "bg-sector-ai text-bg",
  finance: "bg-sector-finance text-bg",
  semis: "bg-sector-semis text-bg",
};

// Tinted: subtle background tint + matching color for the text.
// Using inline `style` rather than arbitrary Tailwind so we can do
// color-mix() against the live token.
const TONE_TINTED_TEXT: Record<BadgeTone, string> = {
  neutral: "text-ink-muted",
  accent: "text-accent",
  warn: "text-warn",
  ok: "text-ok",
  ai: "text-sector-ai",
  finance: "text-sector-finance",
  semis: "text-sector-semis",
};

const TONE_VAR: Record<BadgeTone, string> = {
  neutral: "var(--ink-muted)",
  accent: "var(--accent)",
  warn: "var(--warn)",
  ok: "var(--ok)",
  ai: "var(--ai)",
  finance: "var(--finance)",
  semis: "var(--semis)",
};

export function Badge({
  tone = "neutral",
  variant = "filled",
  className,
  style,
  ...rest
}: BadgeProps): JSX.Element {
  const base =
    "inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-xs font-medium tracking-wide";
  const isTinted = variant === "tinted";
  const cls = [
    base,
    isTinted ? TONE_TINTED_TEXT[tone] : TONE_FILLED[tone],
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  const tintedStyle: React.CSSProperties | undefined = isTinted
    ? { backgroundColor: `color-mix(in srgb, ${TONE_VAR[tone]} 14%, transparent)` }
    : undefined;

  return <span className={cls} style={{ ...tintedStyle, ...style }} {...rest} />;
}
