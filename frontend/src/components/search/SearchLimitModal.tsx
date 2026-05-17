"use client";

import { Lock, X } from "lucide-react";
import { UpgradeCtaButton } from "@/components/stories/UpgradeCta";
import type { GatePayload } from "@/types/story";

// Phase 12g — modal overlay shown when a free user submits a 4th
// search in a day and gets a search_limit gate envelope. Per spec:
// "You've used 3 of 3 searches today. {upgrade_cta.message}".
// Dismissable (the dismiss button closes the overlay), but the
// underlying search results stay empty until the day's counter rolls.
export function SearchLimitModal({
  gate,
  onDismiss,
}: {
  gate: GatePayload;
  onDismiss: () => void;
}): JSX.Element {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="search-limit-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
    >
      <div className="relative w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-xl">
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="absolute right-3 top-3 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="mb-4 flex items-center gap-2 text-slate-900">
          <Lock className="h-5 w-5 text-violet-700" aria-hidden />
          <h2 id="search-limit-title" className="text-lg font-semibold">
            {gate.teaser.headline}
          </h2>
        </div>
        <p className="mb-6 text-sm text-slate-700">
          {gate.teaser.first_line} {gate.upgrade_cta.message}
        </p>
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Dismiss
          </button>
          <UpgradeCtaButton cta={gate.upgrade_cta} />
        </div>
      </div>
    </div>
  );
}
