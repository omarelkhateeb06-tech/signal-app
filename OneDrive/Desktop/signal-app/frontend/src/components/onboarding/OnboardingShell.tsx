"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

export interface OnboardingShellProps {
  step: number;
  title: string;
  description?: string;
  canContinue: boolean;
  isSubmitting?: boolean;
  continueLabel?: string;
  onContinue: () => void | Promise<void>;
  onSkip?: () => void | Promise<void>;
  error?: string | null;
  children: ReactNode;
}

const TOTAL_STEPS = 7;

/**
 * Shared chrome for every onboarding screen: progress bar, title,
 * description, Back / Skip / Continue nav row. Screens plug their
 * content in via `children` and wire their step-specific validation
 * via `canContinue`.
 *
 * Back goes to `/onboarding/${step - 1}` except on step 1, where the
 * button is disabled (the user signed up — there's nowhere sensible
 * to go "back" to).
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
  error,
  children,
}: OnboardingShellProps): JSX.Element {
  const router = useRouter();
  const back = (): void => {
    if (step <= 1) return;
    router.push(`/onboarding/${step - 1}`);
  };

  return (
    <>
      <header className="space-y-2 text-center">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Step {step} of {TOTAL_STEPS}
        </p>
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
        <div
          className="mx-auto h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={TOTAL_STEPS}
          aria-valuenow={step}
        >
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${(step / TOTAL_STEPS) * 100}%` }}
          />
        </div>
      </header>

      <section className="rounded-lg border bg-card p-6 shadow-sm">
        {children}
        {error && (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {error}
          </p>
        )}
      </section>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={back}
          disabled={step <= 1 || isSubmitting}
          className="inline-flex h-10 items-center justify-center rounded-md border px-4 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-40"
        >
          Back
        </button>
        <div className="flex items-center gap-3">
          {onSkip && (
            <button
              type="button"
              onClick={() => {
                void onSkip();
              }}
              disabled={isSubmitting}
              className="inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
            >
              Skip
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              void onContinue();
            }}
            disabled={!canContinue || isSubmitting}
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {isSubmitting
              ? "Saving…"
              : (continueLabel ?? (step === TOTAL_STEPS ? "Finish" : "Continue"))}
          </button>
        </div>
      </div>
    </>
  );
}
