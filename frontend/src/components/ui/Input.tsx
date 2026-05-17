"use client";

import { forwardRef, type InputHTMLAttributes } from "react";

// Phase 12j — Input primitive. Warm border, clear focus state.
// Three sizes; default is md. The optional `leadingIcon` slot is for
// search-style affordances (the Search icon in the auth + search
// surfaces).

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  inputSize?: "sm" | "md" | "lg";
  invalid?: boolean;
  leadingIcon?: React.ReactNode;
  trailingSlot?: React.ReactNode;
}

const SIZE_CLASSES: Record<NonNullable<InputProps["inputSize"]>, string> = {
  sm: "h-9 text-sm",
  md: "h-11 text-base",
  lg: "h-12 text-base",
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { inputSize = "md", invalid, leadingIcon, trailingSlot, className, ...rest },
  ref,
) {
  // Single input with no decoration: render the input alone (no
  // wrapping element). With a leading icon or trailing slot, wrap so
  // we can absolute-position the icon over the padded input.
  if (!leadingIcon && !trailingSlot) {
    const cls = [
      "w-full rounded-md border bg-surface px-3 text-ink",
      "placeholder:text-ink-muted",
      "transition-colors duration-150",
      "focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30",
      invalid ? "border-err" : "border-line",
      SIZE_CLASSES[inputSize],
      className ?? "",
    ]
      .filter(Boolean)
      .join(" ");
    return <input ref={ref} className={cls} {...rest} />;
  }

  const wrapperCls = [
    "relative flex items-center w-full rounded-md border bg-surface",
    "transition-colors duration-150",
    "focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/30",
    invalid ? "border-err" : "border-line",
    SIZE_CLASSES[inputSize],
  ].join(" ");

  const padLeft = leadingIcon ? "pl-10" : "pl-3";
  const padRight = trailingSlot ? "pr-10" : "pr-3";
  const inputCls = [
    "w-full bg-transparent text-ink",
    "placeholder:text-ink-muted",
    "focus:outline-none",
    "h-full",
    padLeft,
    padRight,
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={wrapperCls}>
      {leadingIcon && (
        <span
          className="pointer-events-none absolute left-3 inline-flex items-center text-ink-muted"
          aria-hidden
        >
          {leadingIcon}
        </span>
      )}
      <input ref={ref} className={inputCls} {...rest} />
      {trailingSlot && (
        <span className="absolute right-2 inline-flex items-center">
          {trailingSlot}
        </span>
      )}
    </div>
  );
});
