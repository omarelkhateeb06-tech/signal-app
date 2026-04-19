"use client";

import { useEffect } from "react";

export type ToastTone = "success" | "error";

export interface ToastProps {
  message: string;
  tone?: ToastTone;
  onDismiss: () => void;
  durationMs?: number;
}

export function Toast({ message, tone = "success", onDismiss, durationMs = 3000 }: ToastProps): JSX.Element {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, durationMs);
    return () => window.clearTimeout(timer);
  }, [durationMs, onDismiss]);

  const palette =
    tone === "success"
      ? "bg-foreground text-background"
      : "bg-destructive text-destructive-foreground";

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-md px-4 py-2 text-sm shadow-lg ${palette}`}
    >
      {message}
    </div>
  );
}
