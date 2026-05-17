"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

export interface OnboardingShellProps {
  step: number;
  title: string;
  description?: string;
  canContinue: boolean;
  isSubmitting?: boolean;
  continueLabel?: string;
  onContinue: () => void | Promise<void>;
  onSkip?: () => void | Promise<void>;
  onBack?: () => void | Promise<void>;
  error?: string | null;
  children: ReactNode;
}

const TOTAL_STEPS = 7;

/**
 * Phase 12j — restyled shell. Same prop API, design-token visual
 * layer. Progress is "Step N of M" in mono + a full-width accent
 * progress bar above the title. The card body uses the Card
 * primitive (drops the legacy shadcn `bg-card` semantics in favor of
 * `bg-surface`).
 */
export function OnboardingShell({
  step,
  title,
  description,
  canContinue,
  isSubmitting,
  continueLabel,
  onContinue,
  onSkip,
  onBack,
  error,
  children,
}: OnboardingShellProps): JSX.Element {
  const router = useRouter();
  const back = (): void => {
    if (step <= 1) return;
    if (onBack) {
      void onBack();
      return;
    }
    router.push(`/onboarding/${step - 1}`);
  };

  return (
    <>
      <header className="space-y-4 text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted">
          Step {step} of {TOTAL_STEPS}
        </p>
        <div
          className="mx-auto h-1 w-full max-w-sm overflow-hidden rounded-full bg-line"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={TOTAL_STEPS}
          aria-valuenow={step}
        >
          <div
            className="h-full bg-accent transition-all duration-300 ease-soft-out"
            style={{ width: `${(step / TOTAL_STEPS) * 100}%` }}
          />
        </div>
        <h1 className="font-display text-[32px] font-semibold leading-tight tracking-tight text-ink">
          {title}
        </h1>
        {description && (
          <p className="mx-auto max-w-md text-sm leading-relaxed text-ink-muted">
            {description}
          </p>
        )}
      </header>

      <Card className="p-6">
        {children}
        {error && (
          <p role="alert" className="mt-4 text-sm text-err">
            {error}
          </p>
        )}
      </Card>

      <div className="flex items-center justify-between">
        <Button
          variant="secondary"
          onClick={back}
          disabled={step <= 1 || isSubmitting}
        >
          Back
        </Button>
        <div className="flex items-center gap-3">
          {onSkip && (
            <Button
              variant="ghost"
              onClick={() => {
                void onSkip();
              }}
              disabled={isSubmitting}
            >
              Skip
            </Button>
          )}
          <Button
            onClick={() => {
              void onContinue();
            }}
            disabled={!canContinue || isSubmitting}
          >
            {isSubmitting
              ? "Saving…"
              : (continueLabel ?? (step === TOTAL_STEPS ? "Finish" : "Continue"))}
          </Button>
        </div>
      </div>
    </>
  );
}
