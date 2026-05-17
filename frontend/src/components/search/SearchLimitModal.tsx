"use client";

import { Lock } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { UpgradeCtaButton } from "@/components/stories/UpgradeCta";
import type { GatePayload } from "@/types/story";

// Phase 12j — search-limit modal. The 12g version had its own ad-hoc
// overlay; this version composes the Modal primitive so focus
// management, Escape-to-dismiss, and backdrop blur come for free.
//
// Per the 12j brief: "The modal should feel polite, not punitive."
// Lock icon + headline + the gate's first_line as a single sentence;
// CTA button next to a Dismiss button. No alarm-color treatment.

export function SearchLimitModal({
  gate,
  onDismiss,
}: {
  gate: GatePayload;
  onDismiss: () => void;
}): JSX.Element {
  return (
    <Modal open onDismiss={onDismiss} size="md">
      <div className="mb-4 flex items-center gap-2 text-ink">
        <Lock className="h-5 w-5 text-accent" aria-hidden />
        <h2 className="font-display text-lg font-semibold">
          {gate.teaser.headline}
        </h2>
      </div>
      <p className="mb-6 text-sm leading-relaxed text-ink-muted">
        {gate.teaser.first_line} {gate.upgrade_cta.message}
      </p>
      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={onDismiss}
          className="inline-flex h-10 items-center rounded-md border border-line bg-surface px-4 text-sm font-medium text-ink-muted hover:border-ink-muted hover:text-ink"
        >
          Dismiss
        </button>
        <UpgradeCtaButton cta={gate.upgrade_cta} />
      </div>
    </Modal>
  );
}
