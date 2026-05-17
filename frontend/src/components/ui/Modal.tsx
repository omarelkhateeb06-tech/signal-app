"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

// Phase 12j — Modal primitive. Centered overlay with a backdrop-
// blur scrim. Keyboard-dismissable (Escape). Focus is captured on
// open and restored to the previously-focused element on close.
// Used by SearchLimitModal; the upgrade card on StoryDetail is NOT
// a modal (it renders inline by design — maintain spatial context).

export interface ModalProps {
  open: boolean;
  onDismiss: () => void;
  title?: ReactNode;
  // The aria-labelledby target; required when `title` is omitted
  // and a custom heading is supplied via children.
  labelledById?: string;
  children: ReactNode;
  // Maximum width of the panel; the brief uses a single common size.
  // sm: 360, md: 440 (default), lg: 560.
  size?: "sm" | "md" | "lg";
  // Suppresses the close affordance + Escape handler. Used for
  // mandatory-action modals; the SearchLimit modal stays dismissable.
  dismissable?: boolean;
}

const SIZE_PX: Record<NonNullable<ModalProps["size"]>, string> = {
  sm: "max-w-[360px]",
  md: "max-w-[440px]",
  lg: "max-w-[560px]",
};

export function Modal({
  open,
  onDismiss,
  title,
  labelledById,
  children,
  size = "md",
  dismissable = true,
}: ModalProps): JSX.Element | null {
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Capture / restore focus + Escape handling.
  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    // Defer to next tick so the panel mounts before focus moves.
    const t = window.setTimeout(() => {
      panelRef.current?.focus();
    }, 0);

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape" && dismissable) {
        e.stopPropagation();
        onDismiss();
      }
    };
    document.addEventListener("keydown", onKey);

    // Lock body scroll while modal is open.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocusedRef.current?.focus();
    };
  }, [open, onDismiss, dismissable]);

  if (!open) return null;

  const headingId = title
    ? "modal-title"
    : labelledById ?? undefined;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      {/* Backdrop — clicking it dismisses (when dismissable). */}
      <button
        type="button"
        aria-label="Dismiss"
        tabIndex={-1}
        onClick={() => dismissable && onDismiss()}
        className="absolute inset-0 bg-ink/30 backdrop-blur-sm"
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        className={[
          "relative w-full rounded-lg bg-surface p-6 shadow-modal",
          "animate-fade-up",
          SIZE_PX[size],
        ].join(" ")}
      >
        {dismissable && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-muted hover:bg-bg hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        )}
        {title && (
          <h2 id="modal-title" className="mb-3 font-display text-xl font-semibold text-ink">
            {title}
          </h2>
        )}
        {children}
      </div>
    </div>
  );
}
