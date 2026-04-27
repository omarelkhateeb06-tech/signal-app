"use client";

import { useState, type FormEvent } from "react";
import clsx from "clsx";

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
        className="w-full resize-y rounded-md border border-slate-200 bg-white p-3 text-sm focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
      />
      <div className="flex items-center justify-between gap-2">
        <span
          className={clsx(
            "text-xs",
            value.length > MAX ? "text-rose-600" : "text-slate-500",
          )}
        >
          {value.length}/{MAX}
        </span>
        <div className="flex items-center gap-2">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={disabled}
            className={clsx(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              disabled
                ? "cursor-not-allowed bg-slate-200 text-slate-400"
                : "bg-violet-600 text-white hover:bg-violet-700",
            )}
          >
            {isSubmitting ? "Posting…" : submitLabel}
          </button>
        </div>
      </div>
    </form>
  );
}
