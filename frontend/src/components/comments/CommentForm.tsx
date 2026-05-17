"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";

const MAX = 2000;

interface CommentFormProps {
  placeholder?: string;
  submitLabel?: string;
  initialValue?: string;
  onSubmit: (content: string) => Promise<void> | void;
  onCancel?: () => void;
  isSubmitting?: boolean;
  autoFocus?: boolean;
}

// Phase 12j — restyled onto design tokens. Textarea uses the same
// border / focus pattern as the Input primitive (Input itself is
// single-line, so the textarea stays explicit). Submit + Cancel
// use the Button primitive.
export function CommentForm({
  placeholder = "Add a comment…",
  submitLabel = "Post",
  initialValue = "",
  onSubmit,
  onCancel,
  isSubmitting,
  autoFocus,
}: CommentFormProps): JSX.Element {
  const [value, setValue] = useState(initialValue);
  const trimmed = value.trim();
  const disabled = trimmed.length === 0 || trimmed.length > MAX || Boolean(isSubmitting);

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (disabled) return;
    await onSubmit(trimmed);
    if (!initialValue) setValue("");
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        rows={3}
        autoFocus={autoFocus}
        className="w-full resize-y rounded-md border border-line bg-surface p-3 text-sm text-ink placeholder:text-ink-muted transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
      />
      <div className="flex items-center justify-between gap-2">
        <span
          className={`text-xs ${value.length > MAX ? "text-err" : "text-ink-muted"}`}
        >
          {value.length}/{MAX}
        </span>
        <div className="flex items-center gap-2">
          {onCancel && (
            <Button variant="secondary" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button type="submit" size="sm" disabled={disabled}>
            {isSubmitting ? "Posting…" : submitLabel}
          </Button>
        </div>
      </div>
    </form>
  );
}
